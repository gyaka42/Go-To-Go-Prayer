import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: "#2B8CEE",
        tabBarInactiveTintColor: "#7C8CA5",
        tabBarStyle: {
          backgroundColor: "#0C1724",
          borderTopColor: "#1A2A3D",
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
          title: "Home"
        }}
      />
      <Tabs.Screen
        name="qibla"
        options={{
          title: "Qibla"
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: "Alerts"
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings"
        }}
      />
    </Tabs>
  );
}
