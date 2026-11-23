import * as Device from "expo-device";
import { PermissionsAndroid, Platform } from "react-native";
import type { Device as FlareDevice } from "../../../shared/types";
import FlarePush from "../../modules/flare-push";
import type { Api } from "./api";

export function defaultDeviceName(): string {
  return Device.modelName ?? `${Device.manufacturer ?? "Android"} phone`;
}

/** Android 13+ asks before an app may post notifications. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export type Registration =
  | { state: "registered"; device: FlareDevice }
  | { state: "no-firebase" }
  | { state: "error"; message: string };

/** Registers this phone's FCM token with the signed-in account (safe to repeat). */
export async function registerDevice(api: Api, name: string): Promise<Registration> {
  let token: string | null;
  try {
    token = await FlarePush.getFcmToken();
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
  if (!token) return { state: "no-firebase" };
  try {
    const device = await api.post<FlareDevice>("/api/devices", { name, fcm: { token } });
    return { state: "registered", device };
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Removes this phone from the account, so a signed-out phone stops getting alerts. */
export async function unregisterDevice(api: Api): Promise<void> {
  const token = await FlarePush.getFcmToken().catch(() => null);
  if (!token) return;
  const devices = await api.get<FlareDevice[]>("/api/devices");
  const mine = devices.find((d) => d.kind === "fcm" && d.endpoint === token);
  if (mine) await api.del(`/api/devices/${mine.id}`);
}
