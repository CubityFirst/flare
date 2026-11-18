import { BUILTIN_SOUND_SLUGS } from "@shared/sounds";
import type { Priority, SendMessageResponse } from "@shared/types";
import { z } from "zod";
import { type AppRow, fail, parse, type UserRow } from "./context";
import { randomId } from "./encoding";
import { urgentStub } from "../durable/urgent";
import { buildPushContent, pushToTargets } from "./push";

const intLike = z.union([z.number(), z.string().trim().regex(/^-?\d+$/).transform(Number)]);
const boolLike = z.union([z.boolean(), z.enum(["1", "0", "true", "false", ""]).transform((v) => v === "1" || v === "true")]);
const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

const httpUrl = z
  .string()
  .trim()
  .max(1024)
  .refine((v) => /^https?:\/\//i.test(v), "must be an http(s) URL");

export const sendSchema = z.object({
  message: z.string().trim().min(1, "message is required").max(4096),
  title: z.preprocess(blankToUndefined, z.string().trim().max(250).optional()),
  to: z.preprocess(
    blankToUndefined,
    z.union([z.string().max(2000), z.array(z.string().max(320)).max(20)]).optional(),
  ),
  // Pushover clients send `user`; treat it as an alias for `to`.
  user: z.preprocess(blankToUndefined, z.string().max(2000).optional()),
  priority: z.preprocess(blankToUndefined, intLike.pipe(z.number().int().min(-2).max(2)).optional()),
  sound: z.preprocess(blankToUndefined, z.string().trim().max(64).optional()),
  url: z.preprocess(blankToUndefined, httpUrl.optional()),
  url_title: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
  html: z.preprocess(blankToUndefined, boolLike.optional()),
  ttl: z.preprocess(blankToUndefined, intLike.pipe(z.number().int().min(1).max(365 * 86400)).optional()),
  retry: z.preprocess(blankToUndefined, intLike.pipe(z.number().int().min(30, "retry must be at least 30")).optional()),
  expire: z.preprocess(
    blankToUndefined,
    intLike.pipe(z.number().int().min(30).max(10800, "expire must be at most 10800")).optional(),
  ),
  callback: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .max(1024)
      .refine((v) => /^https:\/\//i.test(v), "callback must be an https URL")
      .optional(),
  ),
  app_id: z.preprocess(blankToUndefined, z.string().max(64).optional()),
});

export type SendInput = z.infer<typeof sendSchema>;

const MAX_RECIPIENT_SPECS = 20;

/** userId -> { groupId the delivery came via (null for direct), notify } */
type RecipientMap = Map<string, { groupId: string | null; notify: boolean }>;

function splitSpecs(to: SendInput["to"] | undefined, user: string | undefined): string[] {
  const raw = to ?? user;
  const list = raw === undefined ? ["me"] : Array.isArray(raw) ? raw : raw.split(",");
  const specs = [...new Set(list.map((s) => s.trim()).filter(Boolean))];
  if (specs.length === 0) return ["me"];
  if (specs.length > MAX_RECIPIENT_SPECS) fail(400, `At most ${MAX_RECIPIENT_SPECS} recipients per message`);
  return specs;
}

async function sharesGroup(env: Env, a: string, b: string) {
  const row = await env.DB.prepare(
    `SELECT 1 FROM group_members x JOIN group_members y ON x.group_id = y.group_id
     WHERE x.user_id = ? AND y.user_id = ? LIMIT 1`,
  )
    .bind(a, b)
    .first();
  return Boolean(row);
}

/**
 * Resolves recipient specs to users, enforcing who the sender may reach:
 * - "me": the sender (for API keys, the app owner)
 * - "user:<email>" / "<email>": admins can reach anyone; others only people they share a group with
 * - "group:<slug>" / "<slug>": the sender must be a member (admins can send to any group)
 */
export async function resolveRecipients(env: Env, sender: UserRow, specs: string[]): Promise<RecipientMap> {
  const out: RecipientMap = new Map();
  const add = (userId: string, groupId: string | null, notify: boolean) => {
    const existing = out.get(userId);
    // A direct delivery, or any non-muted path, wins.
    if (!existing) out.set(userId, { groupId, notify });
    else out.set(userId, { groupId: existing.groupId && groupId ? existing.groupId : null, notify: existing.notify || notify });
  };

  for (const spec of specs) {
    const lower = spec.toLowerCase();
    if (lower === "me") {
      add(sender.id, null, true);
      continue;
    }
    let kind: "user" | "group";
    let value: string;
    if (lower.startsWith("user:")) [kind, value] = ["user", lower.slice(5)];
    else if (lower.startsWith("group:")) [kind, value] = ["group", lower.slice(6)];
    else if (lower.includes("@")) [kind, value] = ["user", lower];
    else [kind, value] = ["group", lower];

    if (kind === "user") {
      const target = await env.DB.prepare(
        "SELECT id FROM users WHERE email = ? COLLATE NOCASE AND status = 'active' LIMIT 1",
      )
        .bind(value)
        .first<{ id: string }>();
      const allowed =
        target && (sender.role === "admin" || target.id === sender.id || (await sharesGroup(env, sender.id, target.id)));
      if (!target || !allowed) fail(400, `Unknown or unauthorised recipient: ${spec}`);
      add(target.id, null, true);
      continue;
    }

    const group = await env.DB.prepare("SELECT id FROM groups WHERE slug = ?").bind(value).first<{ id: string }>();
    if (!group) fail(400, `Unknown or unauthorised recipient: ${spec}`);
    const { results: members } = await env.DB.prepare(
      `SELECT gm.user_id, gm.muted FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ? AND u.status = 'active'`,
    )
      .bind(group.id)
      .all<{ user_id: string; muted: number }>();
    if (sender.role !== "admin" && !members.some((m) => m.user_id === sender.id)) {
      fail(400, `Unknown or unauthorised recipient: ${spec}`);
    }
    for (const m of members) add(m.user_id, group.id, !m.muted);
  }
  return out;
}

async function resolveSound(env: Env, sender: UserRow, slug: string | undefined | null) {
  if (!slug) return { sound: null, soundUrl: null };
  const s = slug.toLowerCase();
  if (BUILTIN_SOUND_SLUGS.has(s)) return { sound: s, soundUrl: null };
  const row = await env.DB.prepare("SELECT id FROM sounds WHERE user_id = ? AND slug = ?")
    .bind(sender.id, s)
    .first<{ id: string }>();
  if (!row) fail(400, `Unknown sound: ${slug}`);
  return { sound: s, soundUrl: `/api/sounds/${row.id}/file` };
}

export async function sendMessage(
  env: Env,
  ctx: ExecutionContext,
  sender: UserRow,
  app: AppRow | null,
  rawInput: unknown,
): Promise<SendMessageResponse> {
  const input = parse(sendSchema, rawInput);
  const priority = (input.priority ?? app?.default_priority ?? 0) as Priority;
  const specs = splitSpecs(input.to, input.user);
  const recipients = await resolveRecipients(env, sender, specs);
  if (recipients.size === 0) fail(400, "No active recipients");

  const { sound, soundUrl } = await resolveSound(env, sender, input.sound ?? app?.default_sound);
  const now = Date.now();
  const messageId = randomId();
  const isUrgent = priority === 2;
  const receiptId = isUrgent ? randomId(30) : null;
  const retry = input.retry ?? 60;
  const expireAt = now + (input.expire ?? 3600) * 1000;

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO messages (id, app_id, app_name, sender_user_id, title, body, html, priority, sound, sound_url,
         url, url_title, targets, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      messageId,
      app?.id ?? null,
      app?.name ?? null,
      sender.id,
      input.title ?? null,
      input.message,
      input.html ? 1 : 0,
      priority,
      sound,
      soundUrl,
      input.url ?? null,
      input.url_title ?? null,
      JSON.stringify(specs),
      now,
      input.ttl ? now + input.ttl * 1000 : null,
    ),
  ];

  const targets: { deliveryId: string; userId: string }[] = [];
  for (const [userId, r] of recipients) {
    const deliveryId = randomId();
    stmts.push(
      env.DB.prepare(
        "INSERT INTO deliveries (id, message_id, user_id, group_id, created_at, notify) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(deliveryId, messageId, userId, r.groupId, now, r.notify ? 1 : 0),
    );
    if (r.notify) targets.push({ deliveryId, userId });
  }

  if (receiptId) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO receipts (id, message_id, retry_seconds, expire_at, callback_url, created_at, last_sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(receiptId, messageId, retry, expireAt, input.callback ?? null, now, now),
    );
  }
  await env.DB.batch(stmts);

  if (priority > -2 && targets.length) {
    const content = buildPushContent({
      id: messageId,
      title: input.title ?? null,
      body: input.message,
      html: Boolean(input.html),
      priority,
      sound,
      soundUrl,
      url: input.url ?? null,
      appName: app?.name ?? null,
      receipt: receiptId,
    });
    ctx.waitUntil(
      pushToTargets(env, targets, content, {
        ttl: isUrgent ? Math.min(retry * 2, 3600) : input.ttl,
        topic: receiptId ?? undefined,
      }).catch((e) => console.error("push fan-out failed", e)),
    );
  }

  if (receiptId) {
    const stub = urgentStub(env, receiptId);
    await stub.start(receiptId, retry, expireAt);
  }

  return { id: messageId, recipients: recipients.size, ...(receiptId ? { receipt: receiptId } : {}) };
}
