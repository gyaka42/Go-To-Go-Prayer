import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { EaseView } from "react-native-ease";
import { SafeAreaView } from "react-native-safe-area-context";
import { easeEnterTransition, easeInitialFade, easeInitialLift, easeStateTransition, easeVisibleFade } from "@/animation/ease";
import { useMotionTransition } from "@/animation/useReducedMotion";
import { AppBackground } from "@/components/AppBackground";
import { StatusChip } from "@/components/StatusChip";
import { useI18n } from "@/i18n/I18nProvider";
import { getDuaDetail } from "@/services/namazContent";
import { getRecentContent, isContentFavorite, saveRecentContent, toggleContentFavorite } from "@/services/storage";
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
  const params = useLocalSearchParams<{ duaId?: string; resume?: string }>();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, localeTag } = useI18n();
  const isLight = resolvedTheme === "light";
  const enterTransition = useMotionTransition(easeEnterTransition);
  const stateTransition = useMotionTransition(easeStateTransition);
  const [fontsLoaded] = useFonts({
    QuranArabic: require("../../../assets/fonts/NotoNaskhArabic-Regular.ttf")
  });

  const duaId = useMemo(() => {
    const value = Array.isArray(params.duaId) ? params.duaId[0] : params.duaId;
    return String(value || "").trim();
  }, [params.duaId]);

  const shouldResume = useMemo(() => {
    const value = Array.isArray(params.resume) ? params.resume[0] : params.resume;
    return value === "1";
  }, [params.resume]);

  const detail = getDuaDetail(duaId);
  const title = detail ? t(detail.titleKey) : t("namaz.invalid_item");
  const [isFavorite, setIsFavorite] = useState(false);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const lastRecentSaveRef = useRef(0);
  const didRestoreScrollRef = useRef(false);

  useEffect(() => {
    if (!detail) {
      return;
    }
    void getRecentContent()
      .then((recent) =>
        saveRecentContent({
          id: `dua:${detail.id}`,
          kind: "namaz_dua",
          route: `/namaz/dua/${detail.id}`,
          title,
          titleKey: detail.titleKey,
          subtitle: t("namaz.section_duas"),
          scrollY: recent?.id === `dua:${detail.id}` ? recent.scrollY : undefined
        })
      )
      .catch(() => undefined);
  }, [detail, t, title]);

  useEffect(() => {
    didRestoreScrollRef.current = false;
  }, [duaId]);

  useEffect(() => {
    if (!shouldResume || !detail || didRestoreScrollRef.current) {
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void getRecentContent().then((recent) => {
        if (!active || recent?.id !== `dua:${detail.id}` || !recent.scrollY || recent.scrollY <= 0) {
          return;
        }
        didRestoreScrollRef.current = true;
        scrollViewRef.current?.scrollTo({ y: recent.scrollY, animated: false });
      });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [detail, shouldResume]);

  const saveScrollPosition = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!detail) {
        return;
      }
      const now = Date.now();
      if (now - lastRecentSaveRef.current < 700) {
        return;
      }
      lastRecentSaveRef.current = now;
      void saveRecentContent({
        id: `dua:${detail.id}`,
        kind: "namaz_dua",
        route: `/namaz/dua/${detail.id}`,
        title,
        titleKey: detail.titleKey,
        subtitle: t("namaz.section_duas"),
        scrollY: Math.max(0, event.nativeEvent.contentOffset.y)
      }).catch(() => undefined);
    },
    [detail, t, title]
  );

  useEffect(() => {
    if (!detail) {
      setIsFavorite(false);
      return;
    }
    let active = true;
    void isContentFavorite(`dua:${detail.id}`).then((value) => {
      if (active) {
        setIsFavorite(value);
      }
    });
    return () => {
      active = false;
    };
  }, [detail]);

  const toggleFavorite = useCallback(async () => {
    if (!detail) {
      return;
    }
    const next = await toggleContentFavorite({
      id: `dua:${detail.id}`,
      kind: "namaz_dua",
      route: `/namaz/dua/${detail.id}`,
      title,
      titleKey: detail.titleKey,
      subtitle: t("namaz.section_duas")
    });
    setIsFavorite(next);
  }, [detail, t, title]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={isLight ? "#1E3D5C" : "#EAF2FF"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          <Pressable onPress={() => void toggleFavorite()} style={styles.headerButton} disabled={!detail}>
            <Ionicons
              name={isFavorite ? "star" : "star-outline"}
              size={22}
              color={isFavorite ? "#F5B942" : isLight ? "#617990" : "#8EA4BF"}
            />
          </Pressable>
        </View>

        {detail ? (
          <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={enterTransition} style={styles.scrollWrap}>
            <ScrollView
              ref={scrollViewRef}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
              onScroll={saveScrollPosition}
              scrollEventThrottle={120}
            >
              <EaseView initialAnimate={easeInitialLift} animate={{ opacity: 1, translateY: 0 }} transition={enterTransition}>
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

              <EaseView initialAnimate={easeInitialLift} animate={{ opacity: 1, translateY: 0 }} transition={enterTransition}>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>{t("namaz.transliteration")}</Text>
                  <Text style={[styles.bodyText, { color: colors.textPrimary }]}>{detail.transliteration}</Text>
                </View>
              </EaseView>

              <EaseView initialAnimate={easeInitialLift} animate={{ opacity: 1, translateY: 0 }} transition={enterTransition}>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>{t("namaz.meaning")}</Text>
                  <Text style={[styles.bodyText, { color: colors.textPrimary }]}>{resolveMeaning(detail, localeTag)}</Text>
                </View>
              </EaseView>

              <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={stateTransition}>
                <StatusChip label={t("namaz.audio_not_available")} tone="info" />
              </EaseView>
            </ScrollView>
          </EaseView>
        ) : (
          <EaseView
            initialAnimate={easeInitialFade}
            animate={easeVisibleFade}
            transition={stateTransition}
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
