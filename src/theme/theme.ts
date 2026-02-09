export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export type AppColors = {
  background: string;
  textPrimary: string;
  textSecondary: string;
  card: string;
  cardBorder: string;
  accent: string;
  accentSoft: string;
  tabBar: string;
  tabBarBorder: string;
};

export const darkColors: AppColors = {
  background: "#081321",
  textPrimary: "#EDF4FF",
  textSecondary: "#8EA4BF",
  card: "#162638",
  cardBorder: "#1D3349",
  accent: "#2B8CEE",
  accentSoft: "#2B8CEE22",
  tabBar: "#0C1724",
  tabBarBorder: "#1A2A3D"
};

export const lightColors: AppColors = {
  background: "#F3F7FC",
  textPrimary: "#0F2238",
  textSecondary: "#50657D",
  card: "#FFFFFF",
  cardBorder: "#D7E2EF",
  accent: "#1E78D9",
  accentSoft: "#1E78D91A",
  tabBar: "#FFFFFF",
  tabBarBorder: "#D7E2EF"
};

export function getColors(theme: ResolvedTheme): AppColors {
  return theme === "dark" ? darkColors : lightColors;
}
