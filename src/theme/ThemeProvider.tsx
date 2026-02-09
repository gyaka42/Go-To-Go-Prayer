import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { AppColors, getColors, ResolvedTheme, ThemeMode } from "@/theme/theme";

const THEME_MODE_KEY = "themeMode:v1";

type ThemeContextValue = {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  colors: AppColors;
  setMode: (mode: ThemeMode) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    void (async () => {
      const saved = await AsyncStorage.getItem(THEME_MODE_KEY);
      if (saved === "light" || saved === "dark" || saved === "system") {
        setModeState(saved);
      }
    })();
  }, []);

  const resolvedTheme: ResolvedTheme =
    mode === "system" ? (systemScheme === "light" ? "light" : "dark") : mode;

  const colors = useMemo(() => getColors(resolvedTheme), [resolvedTheme]);

  const setMode = async (next: ThemeMode) => {
    setModeState(next);
    await AsyncStorage.setItem(THEME_MODE_KEY, next);
  };

  const value = useMemo(
    () => ({ mode, resolvedTheme, colors, setMode }),
    [mode, resolvedTheme, colors]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useAppTheme must be used within ThemeProvider");
  }
  return value;
}
