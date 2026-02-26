import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { playFullAdhan } from "@/services/adhanPlayer";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { useAppTheme } from "@/theme/ThemeProvider";
import { I18nProvider } from "@/i18n/I18nProvider";

function RootNavigation() {
  const { resolvedTheme } = useAppTheme();
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data ?? {}) as {
        playSound?: boolean;
        tone?: string;
      };

      if (data.playSound === false || data.tone !== "Adhan") {
        return;
      }

      void playFullAdhan();
    });

    return () => sub.remove();
  }, []);

  return (
    <>
      <StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="mosques" options={{ headerShown: false }} />
        <Stack.Screen name="zikr" options={{ headerShown: false }} />
        <Stack.Screen name="qaza" options={{ headerShown: false }} />
        <Stack.Screen name="qaza-history" options={{ headerShown: false }} />
        <Stack.Screen name="alert/[prayer]" options={{ headerShown: false }} />
        <Stack.Screen name="methods" options={{ headerShown: false }} />
        <Stack.Screen name="tones" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <RootNavigation />
      </I18nProvider>
    </ThemeProvider>
  );
}
