import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { resolveLocationForSettings } from "@/services/location";
import { fetchMethods, MethodItem, summarizeMethodParams } from "@/services/methods";
import { replanAll } from "@/services/notifications";
import { getSettings, saveSettings } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Settings } from "@/types/prayer";

export default function MethodsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors, resolvedTheme } = useAppTheme();
  const isLight = resolvedTheme === "light";
  const [settings, setSettings] = useState<Settings | null>(null);
  const [methods, setMethods] = useState<MethodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [savedSettings, availableMethods] = await Promise.all([getSettings(), fetchMethods()]);
      setSettings(savedSettings);
      setMethods(availableMethods);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const currentMethodId = settings?.methodId ?? 3;

  const subtitle = useMemo(() => {
    const selected = methods.find((item) => item.id === currentMethodId);
    return selected ? `${selected.name} (${selected.id})` : `Method ID ${currentMethodId}`;
  }, [currentMethodId, methods]);

  const filteredMethods = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return methods;
    }
    return methods.filter((item) => {
      return item.name.toLowerCase().includes(q) || item.key.toLowerCase().includes(q) || String(item.id).includes(q);
    });
  }, [methods, searchQuery]);

  const onSelectMethod = useCallback(
    async (method: MethodItem) => {
      if (!settings) {
        return;
      }

      setSavingId(method.id);
      try {
        const updated: Settings = {
          ...settings,
          methodId: method.id,
          methodName: method.name,
          hanafiOnly: true
        };

        await saveSettings(updated);
        setSettings(updated);

        try {
          const loc = await resolveLocationForSettings(updated);
          await replanAll({
            lat: loc.lat,
            lon: loc.lon,
            methodId: method.id,
            settings: updated
          });
        } catch {
          // Persisting method selection is still valid if location/replan fails.
        }

        navigation.goBack();
      } finally {
        setSavingId(null);
      }
    },
    [navigation, settings]
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={isLight ? "#1E3D5C" : "#EAF2FF"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Calculation Method</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>

        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
        <View
          style={[
            styles.searchWrap,
            isLight
              ? { borderColor: "#C8DBEE", backgroundColor: "#F2F7FD" }
              : null
          ]}
        >
          <Ionicons name="search" size={16} color={isLight ? "#617990" : "#8EA4BF"} />
          <TextInput
            style={[styles.searchInput, isLight ? { color: "#1A2E45" } : null]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search method..."
            placeholderTextColor={isLight ? "#607890" : "#6F849D"}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={16} color={isLight ? "#617990" : "#8EA4BF"} />
            </Pressable>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color="#2B8CEE" size="large" />
          </View>
        ) : (
          <FlatList
            data={filteredMethods}
            keyExtractor={(item) => `${item.key}-${item.id}`}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const selected = item.id === currentMethodId;
              const rowBusy = savingId === item.id;

              return (
                <Pressable
                  style={[
                    styles.row,
                    { backgroundColor: colors.card, borderColor: colors.cardBorder },
                    selected && (isLight ? styles.rowSelectedLight : styles.rowSelected)
                  ]}
                  onPress={() => void onSelectMethod(item)}
                  disabled={savingId !== null}
                >
                  <View style={styles.rowLeft}>
                    <Text
                      style={[
                        styles.rowTitle,
                        isLight ? { color: "#1A2E45" } : null,
                        selected && (isLight ? styles.rowTitleSelectedLight : styles.rowTitleSelected)
                      ]}
                    >
                      {item.name}
                    </Text>
                    <Text style={[styles.rowSub, isLight ? { color: "#4E647C" } : null]}>
                      {summarizeMethodParams(item.params)}
                    </Text>
                  </View>

                  <View style={styles.rowRight}>
                    {rowBusy ? <ActivityIndicator color="#2B8CEE" size="small" /> : null}
                    {selected ? <Ionicons name="checkmark-circle" size={22} color="#2B8CEE" /> : null}
                  </View>
                </Pressable>
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
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#23405B",
    backgroundColor: "#102131",
    paddingHorizontal: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  searchInput: {
    flex: 1,
    color: "#EAF2FF",
    fontSize: 14
  },
  loaderWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  listContent: {
    paddingBottom: 32,
    gap: 10
  },
  row: {
    minHeight: 78,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1D3349",
    backgroundColor: "#162638",
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  rowSelected: {
    borderColor: "#2B8CEE",
    backgroundColor: "#173A5E"
  },
  rowSelectedLight: {
    borderColor: "#69A9EA",
    backgroundColor: "#DDEEFF"
  },
  rowLeft: {
    flex: 1,
    paddingRight: 10
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#EAF2FF"
  },
  rowTitleSelected: {
    color: "#75B8FF"
  },
  rowTitleSelectedLight: {
    color: "#1E78D9"
  },
  rowSub: {
    marginTop: 2,
    fontSize: 13,
    color: "#8FA2BC"
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  }
});
