import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useAppTheme } from "@/theme/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";

export default function TabsLayout() {
  const { colors } = useAppTheme();
  const { t } = useI18n();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.tabBarBorder,
          height: 86,
          paddingTop: 10,
          paddingBottom: 20
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "700"
        },
        tabBarIcon: ({ color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = "home";
          if (route.name === "qibla") {
            iconName = "compass";
          } else if (route.name === "alerts") {
            iconName = "notifications";
          } else if (route.name === "settings") {
            iconName = "settings";
          }
          return <Ionicons name={iconName} size={size} color={color} />;
        }
      })}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.home")
        }}
      />
      <Tabs.Screen
        name="qibla"
        options={{
          title: t("tabs.qibla")
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: t("tabs.alerts")
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("tabs.settings")
        }}
      />
    </Tabs>
  );
}
