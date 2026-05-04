import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { EaseView } from "react-native-ease";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { easeEnterTransition, easeInitialLift, easePressTransition, easeVisibleLift } from "@/animation/ease";
import { useMotionTransition } from "@/animation/useReducedMotion";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import { ContentFavorite, getRecentContent } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";
import { useCallback, useState } from "react";

export default function MenuScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, resolvedTheme } = useAppTheme();
  const { t } = useI18n();
  const isLight = resolvedTheme === "light";
  const enterTransition = useMotionTransition(easeEnterTransition);
  const pressTransition = useMotionTransition(easePressTransition);
  const [pressedCard, setPressedCard] = useState<string | null>(null);
  const [recentContent, setRecentContent] = useState<ContentFavorite | null>(null);

  const recentSubtitle =
    recentContent?.ayahNumber && recentContent.ayahNumber > 0
      ? `${recentContent.kind === "namaz_dua" ? t("favorites.kind_dua") : recentContent.kind === "namaz_asir" ? t("favorites.kind_asir") : t("favorites.kind_quran")} • ${t("favorites.progress_ayah", { ayah: recentContent.ayahNumber })}`
      : recentContent?.subtitle;

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void getRecentContent().then((value) => {
        if (active) {
          setRecentContent(value);
        }
      });
      return () => {
        active = false;
      };
    }, [])
  );

  const menuItems = [
    {
      id: "mosques",
      onPress: () => router.push("/mosques" as never),
      title: t("menu.mosques_title"),
      subtitle: t("menu.mosques_subtitle"),
      icon: (
        <Image
          source={require("../../assets/images/mosque.png")}
          style={[styles.menuPngIcon, { tintColor: "#2B8CEE" }]}
          resizeMode="contain"
        />
      )
    },
    {
      id: "favorites",
      onPress: () => router.push("/mosques?filter=favorites" as never),
      title: t("menu.favorites_title"),
      subtitle: t("menu.favorites_subtitle"),
      icon: <Ionicons name="star-outline" size={20} color="#2B8CEE" />
    },
    {
      id: "zikr",
      onPress: () => router.push("/zikr" as never),
      title: t("menu.zikr.title"),
      subtitle: t("menu.zikr.subtitle"),
      icon: (
        <Image
          source={require("../../assets/images/zikir.png")}
          style={[styles.menuPngIcon, { tintColor: "#2B8CEE" }]}
          resizeMode="contain"
        />
      )
    },
    {
      id: "qaza",
      onPress: () => router.push("/qaza" as never),
      title: t("menu.qaza.title"),
      subtitle: t("menu.qaza.subtitle"),
      icon: (
        <Image
          source={require("../../assets/images/praying.png")}
          style={[styles.menuPngIcon, { tintColor: "#2B8CEE" }]}
          resizeMode="contain"
        />
      )
    },
    {
      id: "quran",
      onPress: () => router.push("/quran" as never),
      title: t("menu.quran.title"),
      subtitle: t("menu.quran.subtitle"),
      icon: (
        <Image
          source={require("../../assets/images/quran.png")}
          style={[styles.menuPngIcon, styles.quranPngIcon, { tintColor: "#2B8CEE" }]}
          resizeMode="contain"
        />
      )
    },
    {
      id: "namaz",
      onPress: () => router.push("/namaz" as never),
      title: t("menu.namaz.title"),
      subtitle: t("menu.namaz.subtitle"),
      icon: (
        <Image
          source={require("../../assets/images/dua.png")}
          style={[styles.menuPngIcon, styles.duaPngIcon, { tintColor: "#2B8CEE" }]}
          resizeMode="contain"
        />
      )
    },
    {
      id: "content-favorites",
      onPress: () => router.push("/favorites" as never),
      title: t("menu.content_favorites.title"),
      subtitle: t("menu.content_favorites.subtitle"),
      icon: <Ionicons name="bookmark-outline" size={21} color="#2B8CEE" />
    },
    {
      id: "monthly",
      onPress: () => router.push("/monthly" as never),
      title: t("menu.monthly.title"),
      subtitle: t("menu.monthly.subtitle"),
      icon: (
        <Image
          source={require("../../assets/images/islamic.png")}
          style={[styles.menuPngIcon, styles.monthlyPngIcon, { tintColor: "#2B8CEE" }]}
          resizeMode="contain"
        />
      )
    }
  ];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("menu.title")}</Text>
        </EaseView>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 112 }]}
        >
          {recentContent ? (
            <EaseView
              initialAnimate={easeInitialLift}
              animate={{ opacity: 1, translateY: 0, scale: pressedCard === "continue-reading" ? 0.985 : 1 }}
              transition={pressedCard === "continue-reading" ? pressTransition : enterTransition}
            >
              <Pressable
                style={[
                  styles.continueCard,
                  { backgroundColor: isLight ? "#E1F0FF" : "#132A44", borderColor: isLight ? "#A8D2FF" : "#315A84" }
                ]}
                onPress={() =>
                  router.push(
                    `${recentContent.route}${recentContent.route.includes("?") ? "&" : "?"}resume=1` as never
                  )
                }
                onPressIn={() => setPressedCard("continue-reading")}
                onPressOut={() => setPressedCard(null)}
              >
                <View style={[styles.iconWrap, isLight ? { backgroundColor: "#F4FAFF" } : null]}>
                  <Ionicons name="play-circle-outline" size={22} color="#2B8CEE" />
                </View>
                <View style={styles.cardTextWrap}>
                  <Text style={[styles.continueEyebrow, { color: isLight ? "#2B8CEE" : "#8DBEFF" }]}>
                    {t("menu.continue_reading.title")}
                  </Text>
                  <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                    {recentContent.titleKey ? t(recentContent.titleKey) : recentContent.title}
                  </Text>
                  {recentSubtitle ? (
                    <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>{recentSubtitle}</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={isLight ? "#617990" : "#8EA4BF"} />
              </Pressable>
            </EaseView>
          ) : null}

          {menuItems.map((item, index) => {
            const pressed = pressedCard === item.id;
            return (
              <EaseView
                key={item.id}
                initialAnimate={easeInitialLift}
                animate={{ opacity: 1, translateY: 0, scale: pressed ? 0.985 : 1 }}
                transition={pressed ? pressTransition : enterTransition}
              >
                <Pressable
                  style={[
                    styles.menuCard,
                    (index > 0 || Boolean(recentContent)) && styles.menuCardSpaced,
                    { backgroundColor: colors.card, borderColor: colors.cardBorder }
                  ]}
                  onPress={item.onPress}
                  onPressIn={() => setPressedCard(item.id)}
                  onPressOut={() => setPressedCard(null)}
                >
                  <View style={[styles.iconWrap, isLight ? { backgroundColor: "#EAF2FC" } : null]}>
                    {item.icon}
                  </View>
                  <View style={styles.cardTextWrap}>
                    <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{item.title}</Text>
                    <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
                      {item.subtitle}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={isLight ? "#617990" : "#8EA4BF"} />
                </Pressable>
              </EaseView>
            );
          })}
        </ScrollView>
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
    color: "#EDF4FF",
    marginBottom: 14
  },
  scrollContent: {
    paddingBottom: 20
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
  continueCard: {
    minHeight: 94,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  continueEyebrow: {
    marginBottom: 3,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#1C3550",
    alignItems: "center",
    justifyContent: "center"
  },
  menuPngIcon: {
    width: 22,
    height: 22
  },
  monthlyPngIcon: {
    width: 24,
    height: 24
  },
  quranPngIcon: {
    width: 23,
    height: 23
  },
  duaPngIcon: {
    width: 23,
    height: 23
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
