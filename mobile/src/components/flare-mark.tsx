import { Image } from "react-native";

/** The Flare app icon (generated with the web icons by scripts/gen-icons.mjs). */
export function FlareMark({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={require("../../assets/icon.png")}
      accessibilityIgnoresInvertColors
      style={{ width: size, height: size, borderRadius: size * 0.22 }}
    />
  );
}
