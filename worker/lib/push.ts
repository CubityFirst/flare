import type { Priority, PushPayload } from "@shared/types";
import { sendWebPush, type Urgency, type VapidKeys } from "./webpush";

export function vapidKeys(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

interface DeviceRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushTarget {
  deliveryId: string;
  userId: string;
}

export type PushContent = Omit<PushPayload, "v" | "type" | "deliveryId" | "ts">;

const MAX_BODY = 1500;
const MAX_TITLE = 200;

function stripHtml(s: string) {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function buildPushContent(m: {
  id: string;
  title: string | null;
  body: string;
  html: boolean;
  priority: Priority;
  sound: string | null;
  soundUrl: string | null;
  url: string | null;
  appName: string | null;
  receipt: string | null;
  attempt?: number;
}): PushContent {
  return {
    messageId: m.id,
    title: truncate(m.title || m.appName || "Flare", MAX_TITLE),
    body: truncate(m.html ? stripHtml(m.body) : m.body, MAX_BODY),
    priority: m.priority,
    sound: m.sound,
    soundUrl: m.soundUrl,
    url: m.url,
    receipt: m.receipt,
    attempt: m.attempt ?? 1,
  };
}

function urgencyFor(p: Priority): Urgency {
  if (p >= 1) return "high";
  if (p === -1) return "low";
  return "normal";
}

/**
 * Sends one push per enabled device of each target user. Records per-device status,
 * deletes dead subscriptions and updates each delivery's `pushed` count.
 */
export async function pushToTargets(
  env: Env,
  targets: PushTarget[],
  content: PushContent,
  opts: { ttl?: number; topic?: string } = {},
): Promise<number> {
  const vapid = vapidKeys(env);
  if (!vapid || targets.length === 0) return 0;

  const byUser = new Map<string, string>();
  for (const t of targets) byUser.set(t.userId, t.deliveryId);
  const userIds = [...byUser.keys()];

  const devices: DeviceRow[] = [];
  for (let i = 0; i < userIds.length; i += 90) {
    const chunk = userIds.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT id, user_id, endpoint, p256dh, auth FROM devices
       WHERE enabled = 1 AND user_id IN (${chunk.map(() => "?").join(",")})`,
    )
      .bind(...chunk)
      .all<DeviceRow>();
    devices.push(...results);
  }

  const now = Date.now();
  const results = await Promise.all(
    devices.map(async (d) => {
      const payload: PushPayload = { v: 1, type: "message", deliveryId: byUser.get(d.user_id)!, ts: now, ...content };
      const r = await sendWebPush(d, JSON.stringify(payload), vapid, {
        ttl: opts.ttl,
        urgency: urgencyFor(content.priority),
        topic: opts.topic,
      });
      return { device: d, result: r };
    }),
  );

  const stmts: D1PreparedStatement[] = [];
  const pushedPerUser = new Map<string, number>();
  for (const { device, result } of results) {
    if (result.ok) {
      pushedPerUser.set(device.user_id, (pushedPerUser.get(device.user_id) ?? 0) + 1);
      stmts.push(
        env.DB.prepare("UPDATE devices SET last_push_at = ?, last_error = NULL WHERE id = ?").bind(now, device.id),
      );
    } else if (result.gone) {
      stmts.push(env.DB.prepare("DELETE FROM devices WHERE id = ?").bind(device.id));
    } else {
      stmts.push(env.DB.prepare("UPDATE devices SET last_error = ? WHERE id = ?").bind(result.error ?? "error", device.id));
    }
  }
  for (const [userId, count] of pushedPerUser) {
    stmts.push(
      env.DB.prepare("UPDATE deliveries SET pushed = pushed + ? WHERE id = ?").bind(count, byUser.get(userId)!),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  return results.filter((r) => r.result.ok).length;
}
