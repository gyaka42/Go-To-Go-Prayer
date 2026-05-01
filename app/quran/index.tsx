import { Ionicons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { EaseView } from "react-native-ease";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { easeEnterTransition, easeInitialFade, easeInitialLift, easePressTransition, easeStaggerTransition, easeStateTransition, easeVisibleFade, easeVisibleLift } from "@/animation/ease";
import { useMotionTransition, useReducedMotion } from "@/animation/useReducedMotion";
import { AppBackground } from "@/components/AppBackground";
import { StatusChip } from "@/components/StatusChip";
import { useI18n } from "@/i18n/I18nProvider";
import { logDiagnostic, quranErrorTranslationKey } from "@/services/errorDiagnostics";
import { getQuranSurahsWithSource, QuranDataSource } from "@/services/quran";
import { useAppTheme } from "@/theme/ThemeProvider";
import { SurahSummary } from "@/types/quran";

let quranListCache: { localeTag: string; rows: SurahSummary[]; source: QuranDataSource } | null = null;
let quranListScrollOffset = 0;
let quranListQuery = "";
let quranListStaggerDone = false;
const QURAN_STAGGER_COUNT = 6;

function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`´]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]/g, "");
}

export default function QuranScreen() {
  const router = useRouter();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, localeTag } = useI18n();
  const isLight = resolvedTheme === "light";
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const pressTransition = useMotionTransition(easePressTransition);
  const stateTransition = useMotionTransition(easeStateTransition);
  const staggerTransition = useMotionTransition(easeStaggerTransition);
  const listRef = useRef<FlatList<SurahSummary> | null>(null);
  const scrollRestoredRef = useRef(false);
  const [fontsLoaded] = useFonts({
    QuranArabic: require("../../assets/fonts/NotoNaskhArabic-Regular.ttf")
  });

  const cachedRows = quranListCache?.localeTag === localeTag ? quranListCache.rows : null;
  const cachedSource = quranListCache?.localeTag === localeTag ? quranListCache.source : null;

  const [rows, setRows] = useState<SurahSummary[]>(cachedRows || []);
  const [dataSource, setDataSource] = useState<QuranDataSource | null>(cachedSource);
  const [loading, setLoading] = useState(!cachedRows);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(quranListQuery);
  const [pressedSurahId, setPressedSurahId] = useState<number | null>(null);
  const [visibleStaggerCount, setVisibleStaggerCount] = useState(
    quranListStaggerDone || quranListScrollOffset > 0 || reduceMotion ? QURAN_STAGGER_COUNT : 0
  );

  const load = useCallback(async (withLoading: boolean = true) => {
    if (withLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      const result = await getQuranSurahsWithSource(localeTag);
      setRows(result.data);
      setDataSource(result.source);
      quranListCache = { localeTag, rows: result.data, source: result.source };
    } catch (err) {
      logDiagnostic("screen.quran.index.load", err, { localeTag });
      setError(t(quranErrorTranslationKey(err)));
    } finally {
      if (withLoading) {
        setLoading(false);
      }
    }
  }, [localeTag]);

  useEffect(() => {
    const hasCache = quranListCache?.localeTag === localeTag && quranListCache.rows.length > 0;
    if (hasCache) {
      setRows(quranListCache?.rows || []);
      setDataSource(quranListCache?.source || "cache");
      setLoading(false);
      return;
    }
    void load(true);
  }, [localeTag, load]);

  useEffect(() => {
    if (scrollRestoredRef.current) {
      return;
    }
    if (loading || rows.length === 0 || quranListScrollOffset <= 0) {
      return;
    }
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: quranListScrollOffset, animated: false });
      scrollRestoredRef.current = true;
    });
  }, [loading, rows.length]);

  useEffect(() => {
    if (reduceMotion || quranListStaggerDone || quranListScrollOffset > 0 || rows.length === 0) {
      setVisibleStaggerCount(QURAN_STAGGER_COUNT);
      quranListStaggerDone = true;
      return;
    }

    let active = true;
    setVisibleStaggerCount(0);

    const timers = Array.from({ length: Math.min(QURAN_STAGGER_COUNT, rows.length) }).map((_, index) =>
      setTimeout(() => {
        if (!active) {
          return;
        }
        setVisibleStaggerCount(index + 1);
        if (index + 1 >= Math.min(QURAN_STAGGER_COUNT, rows.length)) {
          quranListStaggerDone = true;
        }
      }, index * 55)
    );

    return () => {
      active = false;
      timers.forEach(clearTimeout);
    };
  }, [reduceMotion, rows.length]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    quranListQuery = value;
  }, []);

  const filtered = useMemo(() => {
    const trimmed = normalizeForSearch(query.trim());
    if (!trimmed) {
      return rows;
    }
    return rows.filter((row) => {
      const latin = normalizeForSearch(row.nameLatin);
      const arabic = normalizeForSearch(row.nameArabic);
      return (
        String(row.id).includes(trimmed) ||
        arabic.includes(trimmed) ||
        latin.includes(trimmed)
      );
    });
  }, [query, rows]);

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={isLight ? "#1E3D5C" : "#EAF2FF"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("quran.title")}</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>

        <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={easeEnterTransition}>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("quran.subtitle")}</Text>
        </EaseView>

        <View style={styles.statusWrap}>
          <StatusChip
            visible={!loading && !error && Boolean(dataSource)}
            label={dataSource === "cache" ? t("quran.status_cache") : t("quran.status_network")}
            tone={dataSource === "cache" ? "warning" : "success"}
          />
        </View>

        <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={easeEnterTransition}>
          <View style={[styles.searchWrap, { borderColor: colors.cardBorder, backgroundColor: colors.card }]}>
            <Ionicons name="search" size={16} color={isLight ? "#617990" : "#8EA4BF"} />
            <TextInput
              style={[styles.searchInput, { color: colors.textPrimary }]}
              placeholder={t("quran.search_placeholder")}
              placeholderTextColor={isLight ? "#617990" : "#8EA4BF"}
              value={query}
              onChangeText={handleQueryChange}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </EaseView>

        {loading ? (
          <EaseView
            initialAnimate={easeInitialFade}
            animate={easeVisibleFade}
            transition={easeStateTransition}
            style={styles.centerWrap}
          >
            <ActivityIndicator color="#2B8CEE" size="large" />
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>{t("quran.loading")}</Text>
          </EaseView>
        ) : error ? (
          <EaseView
            initialAnimate={easeInitialFade}
            animate={easeVisibleFade}
            transition={easeStateTransition}
            style={styles.centerWrap}
          >
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>{error || t("quran.error_load")}</Text>
            <Pressable style={styles.retryButton} onPress={() => void load()}>
              <Text style={styles.retryButtonText}>{t("common.retry")}</Text>
            </Pressable>
          </EaseView>
        ) : (
          <FlatList
            ref={listRef}
            data={filtered}
            keyExtractor={(item) => String(item.id)}
            style={styles.list}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ListFooterComponent={<View style={{ height: insets.bottom + 120 }} />}
            onScroll={(event) => {
              quranListScrollOffset = event.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            ListEmptyComponent={
              <Text style={[styles.helperText, { color: colors.textSecondary }]}>{t("quran.empty")}</Text>
            }
            renderItem={({ item }) => {
              const pressed = pressedSurahId === item.id;
              const itemIndex = filtered.findIndex((row) => row.id === item.id);
              const shouldStagger = itemIndex > -1 && itemIndex < QURAN_STAGGER_COUNT && visibleStaggerCount <= QURAN_STAGGER_COUNT;
              const revealed = !shouldStagger || itemIndex < visibleStaggerCount;
              return (
                <EaseView
                  initialAnimate={shouldStagger ? { opacity: 0, translateY: 12 } : easeInitialLift}
                  animate={{ opacity: revealed ? 1 : 0, translateY: revealed ? 0 : 12, scale: pressed ? 0.985 : 1 }}
                  transition={pressed ? pressTransition : shouldStagger ? staggerTransition : easeEnterTransition}
                >
                  <Pressable
                    style={[styles.row, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
                    onPress={() => router.push(`/quran/${item.id}` as never)}
                    onPressIn={() => setPressedSurahId(item.id)}
                    onPressOut={() => setPressedSurahId(null)}
                  >
                    <View style={styles.rowLeft}>
                      <Text style={[styles.rowIndex, { color: isLight ? "#1E78D9" : "#8DBEFF" }]}>{item.id}</Text>
                    </View>
                    <View style={styles.rowCenter}>
                      <Text style={[styles.rowLatin, { color: colors.textPrimary }]}>{item.nameLatin}</Text>
                      <Text style={[styles.rowCount, { color: colors.textSecondary }]}>
                        {t("quran.ayah_count", { count: item.ayahCount })}
                      </Text>
                    </View>
                    <View style={styles.rowRight}>
                      <Text
                        style={[
                          styles.rowArabic,
                          { color: colors.textPrimary },
                          fontsLoaded ? styles.quranArabicFont : null
                        ]}
                      >
                        {item.nameArabic}
                      </Text>
                      <Ionicons name="chevron-forward" size={16} color={isLight ? "#617990" : "#8EA4BF"} />
                    </View>
                  </Pressable>
                </EaseView>
              );
            }}
          />
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
  subtitle: {
    marginTop: 8,
    marginBottom: 10,
    fontSize: 14,
    color: "#8EA4BF"
  },
  searchWrap: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  statusWrap: {
    minHeight: 30,
    marginBottom: 8,
    alignItems: "flex-start"
  },
  searchInput: {
    flex: 1,
    fontSize: 15
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10
  },
  helperText: {
    fontSize: 14,
    color: "#8EA4BF"
  },
  retryButton: {
    marginTop: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#2B8CEE"
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontWeight: "700"
  },
  list: {
    flex: 1
  },
  listContent: {
    paddingTop: 12,
    gap: 10
  },
  row: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 78,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center"
  },
  rowLeft: {
    width: 34,
    alignItems: "center"
  },
  rowIndex: {
    fontSize: 17,
    fontWeight: "800",
    color: "#2B8CEE"
  },
  rowCenter: {
    flex: 1
  },
  rowRight: {
    alignItems: "flex-end",
    gap: 4
  },
  rowLatin: {
    fontSize: 16,
    fontWeight: "700",
    color: "#EDF4FF"
  },
  rowCount: {
    marginTop: 4,
    fontSize: 12,
    color: "#8EA4BF"
  },
  rowArabic: {
    fontSize: 22,
    fontWeight: "700",
    color: "#EDF4FF"
  },
  quranArabicFont: {
    fontFamily: "QuranArabic",
    fontWeight: "400"
  }
});
