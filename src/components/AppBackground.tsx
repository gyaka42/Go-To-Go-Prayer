import { StyleSheet, View } from "react-native";
import { useAppTheme } from "@/theme/ThemeProvider";

export function AppBackground() {
  const { resolvedTheme } = useAppTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <>
      <View pointerEvents="none" style={[styles.backgroundGlowTop, !isDark && styles.backgroundGlowTopLight]} />
      <View pointerEvents="none" style={[styles.backgroundGlowBottom, !isDark && styles.backgroundGlowBottomLight]} />
    </>
  );
}

const styles = StyleSheet.create({
  backgroundGlowTop: {
    position: "absolute",
    top: -120,
    right: -80,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: "#2B8CEE22"
  },
  backgroundGlowTopLight: {
    backgroundColor: "#1E78D91F"
  },
  backgroundGlowBottom: {
    position: "absolute",
    bottom: -80,
    left: -80,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "#2B8CEE1A"
  },
  backgroundGlowBottomLight: {
    backgroundColor: "#1E78D914"
  }
});
