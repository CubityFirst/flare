/* Flare service worker: shows push notifications and handles clicks and acknowledgements. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const ICON = "/icons/icon-192.png";
const BADGE = "/icons/badge-96.png";

self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  if (!data || data.type !== "message") {
    data = { type: "message", title: "Flare", body: event.data ? event.data.text() : "", priority: 0 };
  }

  event.waitUntil(
    (async () => {
      // Let open windows refresh the feed and play the alert sound.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) w.postMessage({ type: "flare:push", payload: data });

      const urgent = data.priority === 2;
      const actions = [];
      if (urgent && data.receipt) actions.push({ action: "ack", title: "Acknowledge" });
      if (data.url) actions.push({ action: "open-url", title: "Open link" });

      // iOS and Chrome require every push to show a notification, so always show one.
      await self.registration.showNotification(urgent ? `🚨 ${data.title}` : data.title, {
        body: data.body,
        tag: urgent && data.receipt ? `urgent-${data.receipt}` : data.messageId || undefined,
        renotify: urgent,
        requireInteraction: data.priority >= 1,
        silent: data.priority === -1 || data.sound === "none",
        vibrate: urgent ? [400, 150, 400, 150, 400] : data.priority >= 0 ? [150] : undefined,
        icon: ICON,
        badge: BADGE,
        timestamp: data.ts,
        actions,
        data,
      });
    })(),
  );
});

async function openApp(path) {
  const url = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const w of windows) {
    if (new URL(w.url).origin === self.location.origin) {
      await w.focus();
      w.postMessage({ type: "flare:navigate", path });
      return;
    }
  }
  await self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  event.notification.close();
  const itemPath = data.deliveryId ? `/?item=${encodeURIComponent(data.deliveryId)}` : "/";

  if (event.action === "ack" && data.receipt) {
    event.waitUntil(
      fetch(`/api/receipts/${encodeURIComponent(data.receipt)}/ack`, {
        method: "POST",
        headers: { "x-flare": "1" },
        credentials: "same-origin",
      })
        .then((res) => {
          // 409 means someone already acknowledged it. Otherwise (e.g. signed out) open the app.
          if (!res.ok && res.status !== 409) return openApp(itemPath);
          return self.clients
            .matchAll({ type: "window", includeUncontrolled: true })
            .then((ws) => ws.forEach((w) => w.postMessage({ type: "flare:refresh" })));
        })
        .catch(() => openApp(itemPath)),
    );
    return;
  }

  if (event.action === "open-url" && data.url) {
    event.waitUntil(self.clients.openWindow(data.url));
    return;
  }

  event.waitUntil(openApp(itemPath));
});

// Browsers occasionally rotate subscriptions. Re-register the new one with the same name.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const options = old ? old.options : undefined;
      const sub = event.newSubscription || (options ? await self.registration.pushManager.subscribe(options) : null);
      if (!sub) return;
      await fetch("/api/devices", {
        method: "POST",
        headers: { "content-type": "application/json", "x-flare": "1" },
        credentials: "same-origin",
        body: JSON.stringify({ name: "Renewed subscription", subscription: sub.toJSON() }),
      });
    })(),
  );
});
