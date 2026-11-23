import { NativeModule, requireNativeModule } from "expo";

export type FlarePushEvents = {
  /** A push arrived (or an alert was acknowledged from its notification). `payload` is JSON. */
  onMessage: (event: { payload: string }) => void;
  /** Google rotated this phone's FCM token. The native side has already re-registered it. */
  onToken: (event: { token: string }) => void;
};

export interface PushStatus {
  notificationsEnabled: boolean;
  urgentChannelEnabled: boolean;
  /** Do Not Disturb access, so urgent alerts can break through DND. */
  dndAccess: boolean;
  /** Urgent alerts may open full screen (Android 14+ asks for this). */
  fullScreenAllowed: boolean;
  /** Raise the alarm volume to full while an urgent alert plays. */
  overrideVolume: boolean;
  /** google-services.json was in the build. */
  firebase: boolean;
}

export type SettingsScreen = "notifications" | "urgentChannel" | "dnd" | "fullScreen" | "app";

declare class FlarePushModule extends NativeModule<FlarePushEvents> {
  setSession(baseUrl: string | null, token: string | null, deviceName: string | null): void;
  getSession(): { baseUrl: string | null; token: string | null; deviceName: string | null };
  isFirebaseAvailable(): boolean;
  getFcmToken(): Promise<string | null>;
  getStatus(): PushStatus;
  setOverrideVolume(enabled: boolean): void;
  openSettings(which: SettingsScreen): void;
  dismissAlert(receipt: string): void;
  showLocal(payloadJson: string): Promise<void>;
  previewSound(slug: string, urgent: boolean): Promise<void>;
  stopSound(): void;
}

export default requireNativeModule<FlarePushModule>("FlarePush");
