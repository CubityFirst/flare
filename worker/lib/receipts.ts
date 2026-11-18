import { urgentStub } from "../durable/urgent";
import type { Receipt } from "@shared/types";

export interface ReceiptRow {
  id: string;
  message_id: string;
  retry_seconds: number;
  expire_at: number;
  callback_url: string | null;
  created_at: number;
  last_sent_at: number | null;
  sent_count: number;
  acknowledged_at: number | null;
  acknowledged_by: string | null;
  cancelled_at: number | null;
  expired_at: number | null;
  called_back_at: number | null;
}

export function toReceipt(r: ReceiptRow & { acknowledged_by_name?: string | null }): Receipt {
  return {
    id: r.id,
    acknowledged: r.acknowledged_at !== null,
    acknowledgedAt: r.acknowledged_at,
    acknowledgedBy: r.acknowledged_by_name ?? null,
    lastSentAt: r.last_sent_at,
    sentCount: r.sent_count,
    expired: r.expired_at !== null || (r.acknowledged_at === null && Date.now() >= r.expire_at),
    expireAt: r.expire_at,
    cancelled: r.cancelled_at !== null,
    calledBack: r.called_back_at !== null,
  };
}

export async function getReceipt(env: Env, id: string) {
  return env.DB.prepare(
    `SELECT r.*, m.app_id, m.sender_user_id, COALESCE(u.name, u.email) AS acknowledged_by_name
     FROM receipts r JOIN messages m ON m.id = r.message_id LEFT JOIN users u ON u.id = r.acknowledged_by
     WHERE r.id = ?`,
  )
    .bind(id)
    .first<ReceiptRow & { app_id: string | null; sender_user_id: string | null; acknowledged_by_name: string | null }>();
}

async function stopRepeats(env: Env, id: string) {
  await urgentStub(env, id).stop();
}

/** Acknowledges an urgent alert on behalf of one of its recipients. Returns false if not allowed or already closed. */
export async function acknowledgeReceipt(env: Env, ctx: ExecutionContext, id: string, userId: string) {
  const now = Date.now();
  const res = await env.DB.prepare(
    `UPDATE receipts SET acknowledged_at = ?, acknowledged_by = ?
     WHERE id = ? AND acknowledged_at IS NULL AND cancelled_at IS NULL AND expired_at IS NULL AND expire_at > ?
       AND EXISTS (SELECT 1 FROM deliveries d WHERE d.message_id = receipts.message_id AND d.user_id = ?)`,
  )
    .bind(now, userId, id, now, userId)
    .run();
  if (!res.meta.changes) return false;

  await env.DB.prepare(
    `UPDATE deliveries SET read_at = COALESCE(read_at, ?)
     WHERE user_id = ? AND message_id = (SELECT message_id FROM receipts WHERE id = ?)`,
  )
    .bind(now, userId, id)
    .run();
  await stopRepeats(env, id);
  ctx.waitUntil(runCallback(env, id).catch((e) => console.error("receipt callback failed", e)));
  return true;
}

export async function cancelReceipt(env: Env, id: string) {
  const res = await env.DB.prepare(
    "UPDATE receipts SET cancelled_at = ? WHERE id = ? AND acknowledged_at IS NULL AND cancelled_at IS NULL",
  )
    .bind(Date.now(), id)
    .run();
  await stopRepeats(env, id);
  return Boolean(res.meta.changes);
}

async function runCallback(env: Env, id: string) {
  const r = await env.DB.prepare(
    `SELECT r.callback_url, r.acknowledged_at, r.message_id, u.email FROM receipts r
     LEFT JOIN users u ON u.id = r.acknowledged_by WHERE r.id = ?`,
  )
    .bind(id)
    .first<{ callback_url: string | null; acknowledged_at: number; message_id: string; email: string | null }>();
  if (!r?.callback_url) return;
  const body = new URLSearchParams({
    receipt: id,
    request: r.message_id,
    acknowledged: "1",
    acknowledged_at: String(Math.floor(r.acknowledged_at / 1000)),
    acknowledged_by: r.email ?? "",
  });
  const res = await fetch(r.callback_url, {
    method: "POST",
    body,
    headers: { "user-agent": "Flare-Callback/1" },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) {
    await env.DB.prepare("UPDATE receipts SET called_back_at = ? WHERE id = ?").bind(Date.now(), id).run();
  }
}
