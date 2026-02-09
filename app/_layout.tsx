import { Stack } from "expo-router";
import { ThemeProvider } from "@/theme/ThemeProvider";

export default function RootLayout() {
  return (
    <ThemeProvider>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="alert/[prayer]" options={{ headerShown: false }} />
        <Stack.Screen name="methods" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
