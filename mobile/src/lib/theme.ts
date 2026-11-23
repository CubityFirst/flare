import { useColorScheme } from "react-native";

/** Flare's colours: the web app's fuchsia accent on neutral light and dark surfaces. */
const light = {
  bg: "#ffffff",
  surface: "#f6f5f7",
  border: "#e7e5ea",
  text: "#18161b",
  muted: "#6b6773",
  accent: "#c026d3",
  accentText: "#ffffff",
  accentSoft: "#fae8ff",
  danger: "#dc2626",
  dangerSoft: "#fee2e2",
  warn: "#b45309",
  warnSoft: "#fef3c7",
  ok: "#15803d",
};

const dark: typeof light = {
  bg: "#0f0e11",
  surface: "#1a181d",
  border: "#2a2730",
  text: "#f4f3f6",
  muted: "#9d98a6",
  accent: "#d946ef",
  accentText: "#ffffff",
  accentSoft: "#3b0d44",
  danger: "#f87171",
  dangerSoft: "#3f1414",
  warn: "#fbbf24",
  warnSoft: "#3a2a06",
  ok: "#4ade80",
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}
