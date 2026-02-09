import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { useAppTheme } from "@/theme/ThemeProvider";
import { I18nProvider } from "@/i18n/I18nProvider";

function RootNavigation() {
  const { resolvedTheme } = useAppTheme();

  return (
    <>
      <StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
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
