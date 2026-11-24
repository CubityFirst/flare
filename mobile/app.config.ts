/// <reference types="node" />
import { existsSync } from "node:fs";
import type { ExpoConfig } from "expo/config";

/**
 * Flare for Android.
 *
 * google-services.json (from the Firebase console) is gitignored, since this repo is public.
 * Without it the app still builds and runs, but can't receive pushes.
 */
const googleServicesFile = existsSync("./google-services.json") ? "./google-services.json" : undefined;

const config: ExpoConfig = {
  name: "Flare",
  slug: "flare",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "flare",
  userInterfaceStyle: "automatic",
  android: {
    package: "st.cubityfir.flare",
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: "#1a052a",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: true,
    ...(googleServicesFile && { googleServicesFile }),
  },
  plugins: [
    "expo-router",
    "expo-web-browser",
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 120,
        backgroundColor: "#1a052a",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    /** The Flare server. Debug builds can point elsewhere from the sign-in screen. */
    flareUrl: process.env.FLARE_URL ?? "https://flare.cubityfir.st",
  },
};

export default config;
