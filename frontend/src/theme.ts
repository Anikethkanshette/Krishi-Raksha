import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#0B1410",
  onSurface: "#F4F7F5",
  surfaceSecondary: "#122019",
  onSurfaceSecondary: "#D4DFD7",
  surfaceTertiary: "#1A2D23",
  onSurfaceTertiary: "#BDCEC3",
  surfaceInverse: "#E5A93C",
  onSurfaceInverse: "#062314",
  muted: "#9EAEA4",
  brand: "#062314",
  onBrand: "#F4F7F5",
  brandPrimary: "#1B6B43",
  onBrandPrimary: "#F4F7F5",
  brandSecondary: "#E5A93C",
  onBrandSecondary: "#062314",
  brandTertiary: "#173D29",
  onBrandTertiary: "#BFE1CA",
  success: "#69D59A",
  onSuccess: "#062314",
  warning: "#F6C869",
  onWarning: "#062314",
  error: "#FF9292",
  onError: "#062314",
  info: "#9CC4FF",
  onInfo: "#062314",
  border: "#294233",
  borderStrong: "#527460",
  divider: "#1E3529",
  backdrop: "rgba(0,10,5,0.8)",
  photoShade: "rgba(6,35,20,0.28)",
  transparent: "transparent",
  googleSurface: "#FFFFFF",
  googleInk: "#1F1F1F",
};

export const colors = light;

export type ThemeColors = typeof light;
export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = (system === 'dark' || system === 'light') && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}