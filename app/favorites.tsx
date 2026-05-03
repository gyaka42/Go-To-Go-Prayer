import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { EaseView } from "react-native-ease";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { easeEnterTransition, easeInitialFade, easeInitialLift, easePressTransition, easeVisibleFade } from "@/animation/ease";
import { useMotionTransition } from "@/animation/useReducedMotion";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import { ContentFavorite, getContentFavorites, getRecentContents, setContentFavorites } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";

function iconForKind(kind: ContentFavorite["kind"]): keyof typeof Ionicons.glyphMap {
  if (kind === "quran_surah") {
    return "book-outline";
  }
  if (kind === "namaz_asir") {
    return "sparkles-outline";
  }
  return "document-text-outline";
}

function withResume(route: string): string {
  return `${route}${route.includes("?") ? "&" : "?"}resume=1`;
}

export default function FavoritesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, resolvedTheme } = useAppTheme();
  const { t } = useI18n();
  const isLight = resolvedTheme === "light";
  const enterTransition = useMotionTransition(easeEnterTransition);
  const pressTransition = useMotionTransition(easePressTransition);
  const [items, setItems] = useState<ContentFavorite[]>([]);
  const [recentItems, setRecentItems] = useState<ContentFavorite[]>([]);
  const [pressedId, setPressedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [favorites, recent] = await Promise.all([getContentFavorites(), getRecentContents(10)]);
    setItems(favorites);
    setRecentItems(recent);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const removeFavorite = useCallback(async (id: string) => {
    const next = items.filter((item) => item.id !== id);
    setItems(next);
    await setContentFavorites(next);
  }, [items]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={isLight ? "#1E3D5C" : "#EAF2FF"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("favorites.title")}</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>

        <EaseView initialAnimate={easeInitialLift} animate={{ opacity: 1, translateY: 0 }} transition={enterTransition}>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("favorites.subtitle")}</Text>
        </EaseView>

        {items.length === 0 && recentItems.length === 0 ? (
          <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={enterTransition} style={styles.emptyWrap}>
            <Ionicons name="bookmark-outline" size={36} color={isLight ? "#617990" : "#8EA4BF"} />
            <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>{t("favorites.empty_title")}</Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t("favorites.empty_body")}</Text>
          </EaseView>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
          >
            {recentItems.length > 0 ? (
              <>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{t("favorites.recent_title")}</Text>
                {recentItems.map((item) => {
                  const rowId = `recent:${item.id}`;
                  const pressed = pressedId === rowId;
                  return (
                    <EaseView
                      key={rowId}
                      initialAnimate={easeInitialLift}
                      animate={{ opacity: 1, translateY: 0, scale: pressed ? 0.985 : 1 }}
                      transition={pressed ? pressTransition : enterTransition}
                    >
                      <Pressable
                        style={[
                          styles.row,
                          styles.recentRow,
                          {
                            backgroundColor: isLight ? "#E1F0FF" : "#132A44",
                            borderColor: isLight ? "#A8D2FF" : "#315A84"
                          }
                        ]}
                        onPress={() => router.push(withResume(item.route) as never)}
                        onPressIn={() => setPressedId(rowId)}
                        onPressOut={() => setPressedId(null)}
                      >
                        <View style={[styles.iconWrap, isLight ? { backgroundColor: "#F4FAFF" } : null]}>
                          <Ionicons name="play-circle-outline" size={20} color="#2B8CEE" />
                        </View>
                        <View style={styles.rowTextWrap}>
                          <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>
                            {item.titleKey ? t(item.titleKey) : item.title}
                          </Text>
                          {item.subtitle ? (
                            <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>{item.subtitle}</Text>
                          ) : null}
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={isLight ? "#617990" : "#8EA4BF"} />
                      </Pressable>
                    </EaseView>
                  );
                })}
              </>
            ) : null}

            {items.length > 0 ? (
              <Text
                style={[
                  styles.sectionTitle,
                  recentItems.length > 0 ? styles.sectionTitleSpaced : null,
                  { color: colors.textSecondary }
                ]}
              >
                {t("favorites.saved_title")}
              </Text>
            ) : null}

            {items.map((item) => {
              const pressed = pressedId === item.id;
              return (
                <EaseView
                  key={item.id}
                  initialAnimate={easeInitialLift}
                  animate={{ opacity: 1, translateY: 0, scale: pressed ? 0.985 : 1 }}
                  transition={pressed ? pressTransition : enterTransition}
                >
                  <Pressable
                    style={[styles.row, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
                    onPress={() => router.push(item.route as never)}
                    onPressIn={() => setPressedId(item.id)}
                    onPressOut={() => setPressedId(null)}
                  >
                    <View style={[styles.iconWrap, isLight ? { backgroundColor: "#EAF2FC" } : null]}>
                      <Ionicons name={iconForKind(item.kind)} size={20} color="#2B8CEE" />
                    </View>
                    <View style={styles.rowTextWrap}>
                      <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>{item.titleKey ? t(item.titleKey) : item.title}</Text>
                      {item.subtitle ? (
                        <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>{item.subtitle}</Text>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={(event) => {
                        event.stopPropagation();
                        void removeFavorite(item.id);
                      }}
                      hitSlop={10}
                      style={styles.removeButton}
                    >
                      <Ionicons name="star" size={20} color="#F5B942" />
                    </Pressable>
                  </Pressable>
                </EaseView>
              );
            })}
          </ScrollView>
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
    fontSize: 22,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 14,
    fontSize: 14,
    color: "#8EA4BF",
    textAlign: "center"
  },
  scrollContent: {
    paddingTop: 8,
    gap: 10
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: "#8EA4BF"
  },
  sectionTitleSpaced: {
    marginTop: 10
  },
  row: {
    minHeight: 76,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  recentRow: {
    minHeight: 82
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#1C3550",
    alignItems: "center",
    justifyContent: "center"
  },
  rowTextWrap: {
    flex: 1
  },
  rowTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  rowSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: "#8FA2BC"
  },
  removeButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center"
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    gap: 10
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#EDF4FF",
    textAlign: "center"
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 21,
    color: "#8EA4BF",
    textAlign: "center"
  }
});
