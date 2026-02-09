import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="alert/[prayer]" options={{ headerShown: false }} />
      <Stack.Screen name="methods" options={{ headerShown: false }} />
    </Stack>
  );
}
