import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { EaseView } from "react-native-ease";
import { SafeAreaView } from "react-native-safe-area-context";
import { easeEnterTransition, easeInitialFade, easeInitialLift, easeStateTransition, easeVisibleFade } from "@/animation/ease";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import { getDuaDetail } from "@/services/namazContent";
import { useAppTheme } from "@/theme/ThemeProvider";

function resolveMeaning(content: NonNullable<ReturnType<typeof getDuaDetail>>, localeTag: string): string {
  const lang = String(localeTag || "tr").split("-")[0].toLowerCase();
  if (lang === "en") {
    return content.meaningEn;
  }
  if (lang === "nl") {
    return content.meaningNl;
  }
  return content.meaningTr;
}

export default function NamazDuaDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ duaId?: string }>();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, localeTag } = useI18n();
  const isLight = resolvedTheme === "light";
  const [fontsLoaded] = useFonts({
    QuranArabic: require("../../../assets/fonts/NotoNaskhArabic-Regular.ttf")
  });

  const duaId = useMemo(() => {
    const value = Array.isArray(params.duaId) ? params.duaId[0] : params.duaId;
    return String(value || "").trim();
  }, [params.duaId]);

  const detail = getDuaDetail(duaId);
  const title = detail ? t(detail.titleKey) : t("namaz.invalid_item");

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={isLight ? "#1E3D5C" : "#EAF2FF"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>

        {detail ? (
          <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={easeEnterTransition} style={styles.scrollWrap}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              <EaseView initialAnimate={easeInitialLift} animate={{ opacity: 1, translateY: 0 }} transition={easeEnterTransition}>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>{t("namaz.arabic_text")}</Text>
                  <Text
                    style={[
                      styles.arabicText,
                      { color: colors.textPrimary },
                      fontsLoaded ? styles.quranArabicFont : null
                    ]}
                  >
                    {detail.arabic}
                  </Text>
                </View>
              </EaseView>

              <EaseView initialAnimate={easeInitialLift} animate={{ opacity: 1, translateY: 0 }} transition={easeEnterTransition}>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>{t("namaz.transliteration")}</Text>
                  <Text style={[styles.bodyText, { color: colors.textPrimary }]}>{detail.transliteration}</Text>
                </View>
              </EaseView>

              <EaseView initialAnimate={easeInitialLift} animate={{ opacity: 1, translateY: 0 }} transition={easeEnterTransition}>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>{t("namaz.meaning")}</Text>
                  <Text style={[styles.bodyText, { color: colors.textPrimary }]}>{resolveMeaning(detail, localeTag)}</Text>
                </View>
              </EaseView>

              <Text style={[styles.helperText, { color: colors.textSecondary }]}>{t("namaz.audio_not_available")}</Text>
            </ScrollView>
          </EaseView>
        ) : (
          <EaseView
            initialAnimate={easeInitialFade}
            animate={easeVisibleFade}
            transition={easeStateTransition}
            style={styles.centerWrap}
          >
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>{t("namaz.invalid_item")}</Text>
          </EaseView>
        )}
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  headerButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center"
  },
  headerButtonPlaceholder: {
    width: 34,
    height: 34
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  scrollWrap: {
    flex: 1
  },
  scrollContent: {
    paddingTop: 10,
    paddingBottom: 24,
    gap: 10
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    color: "#8EA4BF",
    marginBottom: 6
  },
  arabicText: {
    fontSize: 27,
    lineHeight: 43,
    textAlign: "right",
    writingDirection: "rtl",
    color: "#EDF4FF"
  },
  quranArabicFont: {
    fontFamily: "QuranArabic",
    fontWeight: "400"
  },
  bodyText: {
    fontSize: 16,
    lineHeight: 24,
    color: "#EDF4FF"
  },
  helperText: {
    fontSize: 13,
    color: "#8EA4BF"
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  }
});
