import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { EaseView } from "react-native-ease";
import { SafeAreaView } from "react-native-safe-area-context";
import { easeEnterTransition, easeInitialLift, easePressTransition, easeStaggerTransition } from "@/animation/ease";
import { useMotionTransition, useReducedMotion } from "@/animation/useReducedMotion";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import { namazSections } from "@/services/namazContent";
import { useAppTheme } from "@/theme/ThemeProvider";
import { NamazListItem } from "@/types/namaz";

let namazListStaggerDone = false;
const NAMAZ_STAGGER_COUNT = 6;

export default function NamazScreen() {
  const router = useRouter();
  const { colors, resolvedTheme } = useAppTheme();
  const { t } = useI18n();
  const isLight = resolvedTheme === "light";
  const reduceMotion = useReducedMotion();
  const pressTransition = useMotionTransition(easePressTransition);
  const staggerTransition = useMotionTransition(easeStaggerTransition);
  const [pressedId, setPressedId] = useState<string | null>(null);
  const [visibleStaggerCount, setVisibleStaggerCount] = useState(
    namazListStaggerDone || reduceMotion ? NAMAZ_STAGGER_COUNT : 0
  );

  const sections = useMemo(
    () =>
      namazSections.map((section) => ({
        ...section,
        title: t(section.titleKey),
        data: section.items
      })),
    [t]
  );

  const flatItems = useMemo(() => sections.flatMap((section) => section.data), [sections]);

  useEffect(() => {
    if (reduceMotion || namazListStaggerDone || flatItems.length === 0) {
      setVisibleStaggerCount(NAMAZ_STAGGER_COUNT);
      namazListStaggerDone = true;
      return;
    }

    let active = true;
    setVisibleStaggerCount(0);

    const timers = Array.from({ length: Math.min(NAMAZ_STAGGER_COUNT, flatItems.length) }).map((_, index) =>
      setTimeout(() => {
        if (!active) {
          return;
        }
        setVisibleStaggerCount(index + 1);
        if (index + 1 >= Math.min(NAMAZ_STAGGER_COUNT, flatItems.length)) {
          namazListStaggerDone = true;
        }
      }, index * 55)
    );

    return () => {
      active = false;
      timers.forEach(clearTimeout);
    };
  }, [flatItems.length, reduceMotion]);

  const onPressItem = (item: NamazListItem) => {
    if (item.kind === "dua") {
      router.push(`/namaz/dua/${item.id}` as never);
      return;
    }

    if (item.kind === "asir") {
      router.push(`/namaz/asir/${item.id}` as never);
      return;
    }

    router.push(`/quran/${item.surahId}` as never);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={isLight ? "#1E3D5C" : "#EAF2FF"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("namaz.title")}</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>

        <EaseView initialAnimate={easeInitialLift} animate={{ opacity: 1, translateY: 0 }} transition={easeEnterTransition}>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("namaz.subtitle")}</Text>
        </EaseView>

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <EaseView initialAnimate={easeInitialLift} animate={{ opacity: 1, translateY: 0 }} transition={easeEnterTransition}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{section.title}</Text>
            </EaseView>
          )}
          renderItem={({ item }) => {
            const pressed = pressedId === item.id;
            const itemIndex = flatItems.findIndex((row) => row.id === item.id);
            const shouldStagger = itemIndex > -1 && itemIndex < NAMAZ_STAGGER_COUNT && visibleStaggerCount <= NAMAZ_STAGGER_COUNT;
            const revealed = !shouldStagger || itemIndex < visibleStaggerCount;
            return (
              <EaseView
                initialAnimate={shouldStagger ? { opacity: 0, translateY: 12 } : easeInitialLift}
                animate={{ opacity: revealed ? 1 : 0, translateY: revealed ? 0 : 12, scale: pressed ? 0.985 : 1 }}
                transition={pressed ? pressTransition : shouldStagger ? staggerTransition : easeEnterTransition}
              >
                <Pressable
                  style={[styles.row, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
                  onPress={() => onPressItem(item)}
                  onPressIn={() => setPressedId(item.id)}
                  onPressOut={() => setPressedId(null)}
                >
                  <View style={styles.rowTextWrap}>
                    <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>{t(item.titleKey)}</Text>
                    {item.kind === "asir" ? (
                      <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>
                        {t("quran.ayah_range", { from: item.fromAyah, to: item.toAyah })}
                      </Text>
                    ) : item.kind === "dua" ? (
                      <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>{t("namaz.dua_hint")}</Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={isLight ? "#617990" : "#8EA4BF"} />
                </Pressable>
              </EaseView>
            );
          }}
        />
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
  subtitle: {
    marginTop: 8,
    marginBottom: 10,
    fontSize: 14,
    color: "#8EA4BF"
  },
  listContent: {
    paddingTop: 6,
    paddingBottom: 24,
    gap: 8
  },
  sectionTitle: {
    marginTop: 8,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    color: "#8EA4BF"
  },
  row: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 66,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  rowTextWrap: {
    flex: 1
  },
  rowTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#EDF4FF"
  },
  rowSubtitle: {
    marginTop: 3,
    fontSize: 12,
    color: "#8EA4BF"
  }
});
