import { DurableObject } from "cloudflare:workers";
import type { Priority } from "@shared/types";
import { buildPushContent, pushToTargets } from "../lib/push";
import type { ReceiptRow } from "../lib/receipts";

/**
 * Typed stub for a receipt's alarm object. The config binds URGENT by Worker *name* (a Worker
 * can't reference its own definition), so cf infers an untyped namespace; narrow it here.
 */
export function urgentStub(env: Env, receiptId: string) {
  const ns = env.URGENT as unknown as DurableObjectNamespace<UrgentAlert>;
  return ns.get(ns.idFromName(receiptId));
}

interface State {
  receiptId: string;
  retrySeconds: number;
  expireAt: number;
}

/**
 * One instance per urgent (priority 2) message, keyed by receipt ID. It re-sends the
 * push every `retry` seconds until the alert is acknowledged, cancelled or expires.
 * D1 is the source of truth; this object only holds the timer.
 */
export class UrgentAlert extends DurableObject<Env> {
  async start(receiptId: string, retrySeconds: number, expireAt: number) {
    await this.ctx.storage.put<State>("state", { receiptId, retrySeconds, expireAt });
    await this.ctx.storage.setAlarm(Math.min(Date.now() + retrySeconds * 1000, expireAt));
  }

  async stop() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    const state = await this.ctx.storage.get<State>("state");
    if (!state) return;
    const env = this.env;

    const r = await env.DB.prepare(
      `SELECT r.*, m.title, m.body, m.html, m.priority, m.sound, m.sound_url, m.url, m.app_name
       FROM receipts r JOIN messages m ON m.id = r.message_id WHERE r.id = ?`,
    )
      .bind(state.receiptId)
      .first<
        ReceiptRow & {
          title: string | null;
          body: string;
          html: number;
          priority: Priority;
          sound: string | null;
          sound_url: string | null;
          url: string | null;
          app_name: string | null;
        }
      >();

    if (!r || r.acknowledged_at || r.cancelled_at || r.expired_at) return this.stop();

    const now = Date.now();
    if (now >= r.expire_at) {
      await env.DB.prepare("UPDATE receipts SET expired_at = ? WHERE id = ? AND expired_at IS NULL")
        .bind(now, r.id)
        .run();
      return this.stop();
    }

    const attempt = r.sent_count + 1;
    const { results: targets } = await env.DB.prepare(
      "SELECT id AS deliveryId, user_id AS userId FROM deliveries WHERE message_id = ? AND notify = 1",
    )
      .bind(r.message_id)
      .all<{ deliveryId: string; userId: string }>();

    const content = buildPushContent({
      id: r.message_id,
      title: r.title,
      body: r.body,
      html: Boolean(r.html),
      priority: r.priority,
      sound: r.sound,
      soundUrl: r.sound_url,
      url: r.url,
      appName: r.app_name,
      receipt: r.id,
      attempt,
    });
    try {
      await pushToTargets(env, targets, content, { ttl: Math.min(r.retry_seconds * 2, 3600), topic: r.id });
    } catch (e) {
      console.error("urgent repeat failed", e);
    }
    await env.DB.prepare("UPDATE receipts SET last_sent_at = ?, sent_count = ? WHERE id = ?")
      .bind(now, attempt, r.id)
      .run();

    // Schedule the next repeat, or a final wake-up at expiry to mark it expired.
    await this.ctx.storage.setAlarm(Math.min(now + r.retry_seconds * 1000, r.expire_at));
  }
}
