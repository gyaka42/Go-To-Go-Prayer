import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { getSettings, saveSettings } from "@/services/storage";
import { PRAYER_NAMES, PrayerName, Settings } from "@/types/prayer";

export default function AlertsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);

  const load = useCallback(async () => {
    const saved = await getSettings();
    setSettings(saved);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const togglePrayer = useCallback(async (prayer: PrayerName, enabled: boolean) => {
    setSettings((prev) => {
      if (!prev) {
        return prev;
      }

      const next = {
        ...prev,
        prayerNotifications: {
          ...prev.prayerNotifications,
          [prayer]: {
            ...prev.prayerNotifications[prayer],
            enabled
          }
        }
      };
      void saveSettings(next);
      return next;
    });
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Alerts</Text>
        <Text style={styles.subtitle}>Tap een gebed om notification preferences te openen.</Text>

        <ScrollView contentContainerStyle={styles.list}>
          {PRAYER_NAMES.map((prayer) => {
            const item = settings?.prayerNotifications[prayer];
            return (
              <Pressable
                key={prayer}
                style={styles.row}
                onPress={() => router.push(`/alert/${prayer}`)}
              >
                <View style={styles.left}>
                  <View style={styles.iconWrap}>
                    <Ionicons name="notifications" size={18} color="#2B8CEE" />
                  </View>
                  <View>
                    <Text style={styles.prayer}>{prayer}</Text>
                    <Text style={styles.meta}>{item ? `${item.minutesBefore} mins before` : "Loading..."}</Text>
                  </View>
                </View>

                <View style={styles.right}>
                  <Switch
                    value={item?.enabled ?? false}
                    onValueChange={(value) => void togglePrayer(prayer, value)}
                  />
                  <Ionicons name="chevron-forward" size={18} color="#8EA4BF" />
                </View>
              </Pressable>
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
    color: "#EDF4FF"
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 14,
    fontSize: 14,
    color: "#8EA4BF"
  },
  list: {
    gap: 12,
    paddingBottom: 32
  },
  row: {
    minHeight: 84,
    borderRadius: 16,
    backgroundColor: "#162638",
    borderWidth: 1,
    borderColor: "#1D3349",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#1C3550",
    alignItems: "center",
    justifyContent: "center"
  },
  prayer: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ECF3FF"
  },
  meta: {
    marginTop: 2,
    fontSize: 13,
    color: "#8FA2BC"
  }
});
