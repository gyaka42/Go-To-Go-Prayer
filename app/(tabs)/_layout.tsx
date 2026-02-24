import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Image, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "@/theme/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";

export default function TabsLayout() {
  const { colors, resolvedTheme } = useAppTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const tabBarBottom = Math.max(insets.bottom - 14, 0);
  const isLight = resolvedTheme === "light";
  const glassBorder = isLight ? "rgba(177, 201, 228, 0.8)" : "rgba(185, 213, 255, 0.24)";
  const fallbackGlass = isLight ? "rgba(245, 250, 255, 0.62)" : "rgba(8, 26, 46, 0.42)";

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          position: "absolute",
          left: 0,
          right: 0,
          marginHorizontal: 20,
          bottom: tabBarBottom,
          height: 74,
          borderRadius: 26,
          backgroundColor: "transparent",
          borderTopWidth: 0,
          borderColor: "transparent",
          elevation: 0,
          shadowColor: "#000000",
          shadowOpacity: 0.28,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
          paddingTop: 10,
          paddingBottom: 8
        },
        tabBarItemStyle: {
          marginHorizontal: 1,
          marginTop: 4,
          marginBottom: 1
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600"
        },
        sceneStyle: {
          backgroundColor: "transparent"
        },
        tabBarBackground: () => (
          <View style={[StyleSheet.absoluteFill, styles.glassWrap, { borderColor: glassBorder }]}>
            <BlurView
              style={StyleSheet.absoluteFill}
              intensity={55}
              tint={isLight ? "light" : "dark"}
            />
            <View style={[styles.glassOverlay, { backgroundColor: fallbackGlass }]} />
          </View>
        ),
        tabBarIcon: ({ color, size, focused }) => {
          let iconName: keyof typeof Ionicons.glyphMap = "home-outline";
          if (route.name === "qibla") {
            return (
              <FontAwesome5
                name="kaaba"
                size={Math.max(size - 1, 14)}
                color={color}
                solid={focused}
              />
            );
          } else if (route.name === "menu") {
            return (
              <Image
                source={require("../../assets/images/MenuMore.png")}
                style={[
                  styles.menuIcon,
                  {
                    width: Math.max(size + 1, 22),
                    height: Math.max(size + 1, 22),
                    opacity: focused ? 1 : 0.82,
                    tintColor: color
                  }
                ]}
                resizeMode="contain"
              />
            );
          } else if (route.name === "settings") {
            iconName = focused ? "settings" : "settings-outline";
          } else {
            iconName = focused ? "home" : "home-outline";
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
        name="menu"
        options={{
          title: t("tabs.menu")
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

const styles = StyleSheet.create({
  glassWrap: {
    borderRadius: 26,
    overflow: "hidden",
    borderWidth: 1
  },
  glassOverlay: {
    ...StyleSheet.absoluteFillObject
  },
  menuIcon: {
    tintColor: "#8EA4BF"
  }
});
