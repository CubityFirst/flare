/** Browser-side Web Push helpers: service worker registration and subscriptions. */
import { api } from "./api";

export type PushSupport =
  | { state: "unsupported"; reason: string }
  | { state: "needs-install" } // iOS Safari: must be added to the home screen first
  | { state: "denied" }
  | { state: "default" | "granted" };

export function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  if (!("serviceWorker" in navigator)) return { state: "unsupported", reason: "This browser has no service worker support." };
  if (!("PushManager" in window) || !("Notification" in window)) {
    if (isIos() && !isStandalone()) return { state: "needs-install" };
    return { state: "unsupported", reason: "This browser doesn't support Web Push." };
  }
  if (Notification.permission === "denied") return { state: "denied" };
  return { state: Notification.permission };
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => {
    console.error("Service worker registration failed", e);
    return null;
  });
}

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription() {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export function defaultDeviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || isIos()
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "Device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return isStandalone() ? `${os} (app)` : `${os} ${browser}`;
}

/** Asks for permission (must be called from a user gesture), subscribes and registers the device. */
export async function enablePush(vapidPublicKey: string, name: string) {
  if (!vapidPublicKey) throw new Error("The server has no VAPID key configured.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = urlBase64ToUint8Array(vapidPublicKey);
  // If the server's key changed, the old subscription is useless.
  if (sub) {
    const existing = sub.options.applicationServerKey;
    const same = existing && new Uint8Array(existing).every((b, i) => b === key[i]);
    if (!same) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return api.registerDevice({ name, subscription: sub.toJSON() });
}

export async function disablePushOnThisDevice() {
  const sub = await currentSubscription();
  await sub?.unsubscribe();
  return sub?.endpoint ?? null;
}
