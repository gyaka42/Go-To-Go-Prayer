import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { useAppTheme } from "@/theme/ThemeProvider";

function RootNavigation() {
  const { resolvedTheme } = useAppTheme();

  return (
    <>
      <StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="alert/[prayer]" options={{ headerShown: false }} />
        <Stack.Screen name="methods" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootNavigation />
    </ThemeProvider>
  );
}
