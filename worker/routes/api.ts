import { Hono } from "hono";
import { BUILTIN_SOUND_SLUGS, BUILTIN_SOUNDS } from "@shared/sounds";
import type {
  ApiKey,
  App,
  CreatedApiKey,
  Device,
  FeedItem,
  FeedPage,
  Group,
  GroupMember,
  Me,
  Priority,
  Sound,
  User,
} from "@shared/types";
import { z } from "zod";
import { type AppEnv, type AppRow, type Ctx, fail, jsonBody, parse, type UserRow } from "../lib/context";
import { randomId, sha256Hex } from "../lib/encoding";
import { oidcConfigured } from "../lib/oidc";
import { passwordLoginAllowed } from "./auth";
import { acknowledgeReceipt, type ReceiptRow, toReceipt } from "../lib/receipts";
import { sendMessage } from "../lib/send";
import { loadSessionUser } from "../lib/session";

export const api = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Public

api.get("/config", (c) =>
  c.json({
    appName: c.env.APP_NAME,
    oidc: oidcConfigured(c.env),
    devAuth: c.env.DEV_AUTH === "true" && ["localhost", "127.0.0.1"].includes(new URL(c.req.url).hostname),
    passwordLogin: passwordLoginAllowed(c.env),
  }),
);

// ---------------------------------------------------------------------------
// Session auth. Mutating requests must carry `x-flare: 1`, which a cross-site form
// can't set, as CSRF protection on top of SameSite=Lax cookies.

api.use("*", async (c, next) => {
  const user = await loadSessionUser(c);
  if (!user) fail(401, "Not signed in");
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("x-flare") !== "1") {
    fail(403, "Missing x-flare header");
  }
  c.set("user", user);
  await next();
});

export function toUser(u: UserRow): User {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    picture: u.picture,
    role: u.role,
    status: u.status,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

api.get("/me", (c) =>
  c.json<Me>({ user: toUser(c.get("user")), vapidPublicKey: c.env.VAPID_PUBLIC_KEY, appName: c.env.APP_NAME }),
);

// Everything below needs an approved account.
api.use("*", async (c, next) => {
  const u = c.get("user");
  if (u.status !== "active") fail(403, u.status === "pending" ? "Account awaiting approval" : "Account disabled");
  await next();
});

const requireAdmin = (c: Ctx) => {
  if (c.get("user").role !== "admin") fail(403, "Admins only");
};

// ---------------------------------------------------------------------------
// Feed

interface FeedRow {
  id: string;
  message_id: string;
  created_at: number;
  read_at: number | null;
  title: string | null;
  body: string;
  html: number;
  priority: Priority;
  sound: string | null;
  sound_url: string | null;
  url: string | null;
  url_title: string | null;
  app_name: string | null;
  sender_name: string | null;
  group_name: string | null;
  r_id: string | null;
  r_retry_seconds: number;
  r_expire_at: number;
  r_created_at: number;
  r_last_sent_at: number | null;
  r_sent_count: number;
  r_acknowledged_at: number | null;
  r_acknowledged_by_name: string | null;
  r_cancelled_at: number | null;
  r_expired_at: number | null;
  r_called_back_at: number | null;
}

function toFeedItem(r: FeedRow): FeedItem {
  return {
    id: r.id,
    messageId: r.message_id,
    title: r.title,
    body: r.body,
    html: Boolean(r.html),
    priority: r.priority,
    sound: r.sound,
    soundUrl: r.sound_url,
    url: r.url,
    urlTitle: r.url_title,
    appName: r.app_name,
    senderName: r.sender_name,
    groupName: r.group_name,
    createdAt: r.created_at,
    readAt: r.read_at,
    receipt: r.r_id
      ? toReceipt({
          id: r.r_id,
          message_id: r.message_id,
          retry_seconds: r.r_retry_seconds,
          expire_at: r.r_expire_at,
          callback_url: null,
          created_at: r.r_created_at,
          last_sent_at: r.r_last_sent_at,
          sent_count: r.r_sent_count,
          acknowledged_at: r.r_acknowledged_at,
          acknowledged_by: null,
          acknowledged_by_name: r.r_acknowledged_by_name,
          cancelled_at: r.r_cancelled_at,
          expired_at: r.r_expired_at,
          called_back_at: r.r_called_back_at,
        } satisfies ReceiptRow & { acknowledged_by_name: string | null })
      : null,
  };
}

const FEED_SELECT = `
  SELECT d.id, d.message_id, d.created_at, d.read_at,
         m.title, m.body, m.html, m.priority, m.sound, m.sound_url, m.url, m.url_title, m.app_name,
         COALESCE(s.name, s.email) AS sender_name, g.name AS group_name,
         r.id AS r_id, r.retry_seconds AS r_retry_seconds, r.expire_at AS r_expire_at, r.created_at AS r_created_at,
         r.last_sent_at AS r_last_sent_at, r.sent_count AS r_sent_count, r.acknowledged_at AS r_acknowledged_at,
         COALESCE(au.name, au.email) AS r_acknowledged_by_name, r.cancelled_at AS r_cancelled_at,
         r.expired_at AS r_expired_at, r.called_back_at AS r_called_back_at
  FROM deliveries d
  JOIN messages m ON m.id = d.message_id
  LEFT JOIN users s ON s.id = m.sender_user_id
  LEFT JOIN groups g ON g.id = d.group_id
  LEFT JOIN receipts r ON r.message_id = m.id
  LEFT JOIN users au ON au.id = r.acknowledged_by`;

api.get("/feed", async (c) => {
  const user = c.get("user");
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 30, 1), 100);
  const unreadOnly = c.req.query("unread") === "1";
  const cursor = c.req.query("cursor");
  let [cTs, cId] = [Number.MAX_SAFE_INTEGER, "~"];
  if (cursor) {
    const [ts, id] = cursor.split("_");
    [cTs, cId] = [Number(ts), id ?? "~"];
    if (!Number.isFinite(cTs)) fail(400, "Bad cursor");
  }
  const now = Date.now();
  const { results } = await c.env.DB.prepare(
    `${FEED_SELECT}
     WHERE d.user_id = ? AND d.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > ?)
       ${unreadOnly ? "AND d.read_at IS NULL" : ""}
       AND (d.created_at < ? OR (d.created_at = ? AND d.id < ?))
     ORDER BY d.created_at DESC, d.id DESC LIMIT ?`,
  )
    .bind(user.id, now, cTs, cTs, cId, limit + 1)
    .all<FeedRow>();

  const unread = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM deliveries d JOIN messages m ON m.id = d.message_id
     WHERE d.user_id = ? AND d.deleted_at IS NULL AND d.read_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > ?)`,
  )
    .bind(user.id, now)
    .first<{ n: number }>();

  const page = results.slice(0, limit);
  const last = page.at(-1);
  return c.json<FeedPage>({
    items: page.map(toFeedItem),
    nextCursor: results.length > limit && last ? `${last.created_at}_${last.id}` : null,
    unread: unread?.n ?? 0,
  });
});

api.get("/feed/count", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM deliveries d JOIN messages m ON m.id = d.message_id
     WHERE d.user_id = ? AND d.deleted_at IS NULL AND d.read_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > ?)`,
  )
    .bind(c.get("user").id, Date.now())
    .first<{ n: number }>();
  return c.json({ unread: row?.n ?? 0 });
});

api.get("/feed/:id", async (c) => {
  const row = await c.env.DB.prepare(`${FEED_SELECT} WHERE d.id = ? AND d.user_id = ? AND d.deleted_at IS NULL`)
    .bind(c.req.param("id"), c.get("user").id)
    .first<FeedRow>();
  if (!row) fail(404, "Not found");
  return c.json(toFeedItem(row));
});

api.post("/feed/:id/read", async (c) => {
  await c.env.DB.prepare("UPDATE deliveries SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?")
    .bind(Date.now(), c.req.param("id"), c.get("user").id)
    .run();
  return c.json({ ok: true });
});

api.post("/feed/:id/unread", async (c) => {
  await c.env.DB.prepare("UPDATE deliveries SET read_at = NULL WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("user").id)
    .run();
  return c.json({ ok: true });
});

api.post("/feed/read-all", async (c) => {
  await c.env.DB.prepare("UPDATE deliveries SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
    .bind(Date.now(), c.get("user").id)
    .run();
  return c.json({ ok: true });
});

api.delete("/feed/:id", async (c) => {
  await c.env.DB.prepare("UPDATE deliveries SET deleted_at = ? WHERE id = ? AND user_id = ?")
    .bind(Date.now(), c.req.param("id"), c.get("user").id)
    .run();
  return c.json({ ok: true });
});

/** Removes every read message from the feed. */
api.post("/feed/clear-read", async (c) => {
  await c.env.DB.prepare(
    "UPDATE deliveries SET deleted_at = ? WHERE user_id = ? AND read_at IS NOT NULL AND deleted_at IS NULL",
  )
    .bind(Date.now(), c.get("user").id)
    .run();
  return c.json({ ok: true });
});

api.post("/receipts/:id/ack", async (c) => {
  const ok = await acknowledgeReceipt(c.env, c.executionCtx as ExecutionContext, c.req.param("id"), c.get("user").id);
  if (!ok) fail(409, "This alert was already acknowledged, cancelled or expired");
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Sending from the web UI

async function loadOwnApp(c: Ctx, id: string): Promise<AppRow> {
  const app = await c.env.DB.prepare("SELECT * FROM apps WHERE id = ? AND user_id = ?")
    .bind(id, c.get("user").id)
    .first<AppRow>();
  if (!app) fail(404, "App not found");
  return app;
}

api.post("/messages", async (c) => {
  const body = (await jsonBody(c)) as Record<string, unknown>;
  const app = typeof body.app_id === "string" && body.app_id ? await loadOwnApp(c, body.app_id) : null;
  const res = await sendMessage(c.env, c.executionCtx as ExecutionContext, c.get("user"), app, body);
  return c.json(res, 201);
});

// ---------------------------------------------------------------------------
// Devices (Web Push subscriptions)

const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];

const deviceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  subscription: z.object({
    endpoint: z
      .string()
      .url()
      .max(2048)
      .refine((u) => {
        const url = new URL(u);
        return url.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(url.hostname));
      }, "Unsupported push service"),
    keys: z.object({ p256dh: z.string().min(80).max(100), auth: z.string().min(16).max(32) }),
  }),
});

interface DeviceRow {
  id: string;
  name: string;
  endpoint: string;
  user_agent: string | null;
  enabled: number;
  created_at: number;
  last_push_at: number | null;
  last_error: string | null;
}

const toDevice = (d: DeviceRow): Device => ({
  id: d.id,
  name: d.name,
  kind: "webpush",
  endpointHost: new URL(d.endpoint).hostname,
  endpoint: d.endpoint,
  userAgent: d.user_agent,
  enabled: Boolean(d.enabled),
  createdAt: d.created_at,
  lastPushAt: d.last_push_at,
  lastError: d.last_error,
});

api.get("/devices", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC")
    .bind(c.get("user").id)
    .all<DeviceRow>();
  return c.json(results.map(toDevice));
});

api.post("/devices", async (c) => {
  const input = parse(deviceSchema, await jsonBody(c));
  const user = c.get("user");
  const ua = c.req.header("user-agent")?.slice(0, 300) ?? null;
  const now = Date.now();
  // Re-subscribing the same browser (or signing in as someone else on it) takes over the endpoint.
  await c.env.DB.prepare(
    `INSERT INTO devices (id, user_id, name, endpoint, p256dh, auth, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, name = excluded.name,
       p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, enabled = 1, last_error = NULL`,
  )
    .bind(randomId(), user.id, input.name, input.subscription.endpoint, input.subscription.keys.p256dh,
      input.subscription.keys.auth, ua, now)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM devices WHERE endpoint = ?")
    .bind(input.subscription.endpoint)
    .first<DeviceRow>();
  return c.json(toDevice(row!), 201);
});

api.patch("/devices/:id", async (c) => {
  const input = parse(
    z.object({ name: z.string().trim().min(1).max(80).optional(), enabled: z.boolean().optional() }),
    await jsonBody(c),
  );
  const user = c.get("user");
  const row = await c.env.DB.prepare(
    `UPDATE devices SET name = COALESCE(?, name), enabled = COALESCE(?, enabled)
     WHERE id = ? AND user_id = ? RETURNING *`,
  )
    .bind(input.name ?? null, input.enabled === undefined ? null : Number(input.enabled), c.req.param("id"), user.id)
    .first<DeviceRow>();
  if (!row) fail(404, "Device not found");
  return c.json(toDevice(row));
});

api.delete("/devices/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM devices WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("user").id)
    .run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Apps and API keys

interface KeyRow {
  id: string;
  app_id: string;
  label: string | null;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

const toKey = (k: KeyRow): ApiKey => ({
  id: k.id,
  label: k.label,
  prefix: k.prefix,
  createdAt: k.created_at,
  lastUsedAt: k.last_used_at,
  revokedAt: k.revoked_at,
});

const toApp = (a: AppRow, keys: KeyRow[], messageCount: number): App => ({
  id: a.id,
  name: a.name,
  description: a.description,
  defaultSound: a.default_sound,
  defaultPriority: a.default_priority as Priority,
  createdAt: a.created_at,
  keys: keys.map(toKey),
  messageCount,
});

/**
 * Secret API keys look like `sk_flr_<32 random chars>`, following the Stripe-style
 * convention: `sk_` marks a secret key, and the fixed prefix lets people (and secret
 * scanners) recognise a leaked Flare key. Keys created before this prefix (`flr_…`)
 * keep working, because lookup is by hash.
 */
export const API_KEY_PREFIX = "sk_flr_";

async function createKey(env: Env, appId: string, label: string | null): Promise<CreatedApiKey> {
  const secret = `${API_KEY_PREFIX}${randomId(32)}`;
  const row: KeyRow = {
    id: randomId(),
    app_id: appId,
    label,
    // The fixed prefix plus 6 random characters, enough to tell keys apart in the UI.
    prefix: secret.slice(0, API_KEY_PREFIX.length + 6),
    created_at: Date.now(),
    last_used_at: null,
    revoked_at: null,
  };
  await env.DB.prepare("INSERT INTO api_keys (id, app_id, label, prefix, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(row.id, appId, label, row.prefix, await sha256Hex(secret), row.created_at)
    .run();
  return { key: toKey(row), secret };
}

async function validateSoundSlug(c: Ctx, slug: string | null | undefined) {
  if (!slug) return null;
  const s = slug.toLowerCase();
  if (BUILTIN_SOUND_SLUGS.has(s)) return s;
  const row = await c.env.DB.prepare("SELECT 1 FROM sounds WHERE user_id = ? AND slug = ?")
    .bind(c.get("user").id, s)
    .first();
  if (!row) fail(400, `Unknown sound: ${slug}`);
  return s;
}

const appSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).nullish(),
  defaultSound: z.string().trim().max(64).nullish(),
  defaultPriority: z.number().int().min(-2).max(2).optional(),
});

async function appWithKeys(c: Ctx, app: AppRow) {
  const { results: keys } = await c.env.DB.prepare(
    "SELECT * FROM api_keys WHERE app_id = ? ORDER BY revoked_at IS NOT NULL, created_at DESC",
  )
    .bind(app.id)
    .all<KeyRow>();
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE app_id = ?")
    .bind(app.id)
    .first<{ n: number }>();
  return toApp(app, keys, count?.n ?? 0);
}

api.get("/apps", async (c) => {
  const user = c.get("user");
  const [apps, keys, counts] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM apps WHERE user_id = ? ORDER BY created_at").bind(user.id),
    c.env.DB.prepare(
      `SELECT k.* FROM api_keys k JOIN apps a ON a.id = k.app_id WHERE a.user_id = ?
       ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`,
    ).bind(user.id),
    c.env.DB.prepare(
      "SELECT m.app_id, COUNT(*) AS n FROM messages m JOIN apps a ON a.id = m.app_id WHERE a.user_id = ? GROUP BY m.app_id",
    ).bind(user.id),
  ]);
  const countMap = new Map((counts.results as { app_id: string; n: number }[]).map((r) => [r.app_id, r.n]));
  return c.json(
    (apps.results as unknown as AppRow[]).map((a) =>
      toApp(a, (keys.results as unknown as KeyRow[]).filter((k) => k.app_id === a.id), countMap.get(a.id) ?? 0),
    ),
  );
});

api.post("/apps", async (c) => {
  const input = parse(appSchema, await jsonBody(c));
  const user = c.get("user");
  const app: AppRow = {
    id: randomId(),
    user_id: user.id,
    name: input.name,
    description: input.description ?? null,
    default_sound: await validateSoundSlug(c, input.defaultSound),
    default_priority: input.defaultPriority ?? 0,
    created_at: Date.now(),
  };
  await c.env.DB.prepare(
    "INSERT INTO apps (id, user_id, name, description, default_sound, default_priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(app.id, app.user_id, app.name, app.description, app.default_sound, app.default_priority, app.created_at)
    .run();
  const created = await createKey(c.env, app.id, "Default");
  return c.json({ app: { ...toApp(app, [], 0), keys: [created.key] }, secret: created.secret }, 201);
});

api.patch("/apps/:id", async (c) => {
  const app = await loadOwnApp(c, c.req.param("id"));
  const input = parse(appSchema.partial(), await jsonBody(c));
  const next: AppRow = {
    ...app,
    name: input.name ?? app.name,
    description: input.description === undefined ? app.description : input.description,
    default_sound: input.defaultSound === undefined ? app.default_sound : await validateSoundSlug(c, input.defaultSound),
    default_priority: input.defaultPriority ?? app.default_priority,
  };
  await c.env.DB.prepare("UPDATE apps SET name = ?, description = ?, default_sound = ?, default_priority = ? WHERE id = ?")
    .bind(next.name, next.description, next.default_sound, next.default_priority, app.id)
    .run();
  return c.json(await appWithKeys(c, next));
});

api.delete("/apps/:id", async (c) => {
  const app = await loadOwnApp(c, c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM apps WHERE id = ?").bind(app.id).run();
  return c.json({ ok: true });
});

api.post("/apps/:id/keys", async (c) => {
  const app = await loadOwnApp(c, c.req.param("id"));
  const input = parse(z.object({ label: z.string().trim().max(80).nullish() }), await jsonBody(c));
  const { n } = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE app_id = ? AND revoked_at IS NULL")
    .bind(app.id)
    .first<{ n: number }>())!;
  if (n >= 10) fail(400, "An app can have at most 10 active keys");
  return c.json(await createKey(c.env, app.id, input.label || null), 201);
});

api.delete("/apps/:id/keys/:keyId", async (c) => {
  const app = await loadOwnApp(c, c.req.param("id"));
  await c.env.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND app_id = ? AND revoked_at IS NULL")
    .bind(Date.now(), c.req.param("keyId"), app.id)
    .run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Groups

interface GroupRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: number;
  member_count: number;
  my_role: "owner" | "member" | null;
  my_muted: number | null;
}

const toGroup = (g: GroupRow): Group => ({
  id: g.id,
  slug: g.slug,
  name: g.name,
  description: g.description,
  createdAt: g.created_at,
  memberCount: g.member_count,
  myRole: g.my_role,
  muted: Boolean(g.my_muted),
});

const GROUP_SELECT = `
  SELECT g.*, (SELECT COUNT(*) FROM group_members x WHERE x.group_id = g.id) AS member_count,
         me.role AS my_role, me.muted AS my_muted
  FROM groups g LEFT JOIN group_members me ON me.group_id = g.id AND me.user_id = ?`;

async function loadGroup(c: Ctx, id: string, need: "member" | "owner") {
  const user = c.get("user");
  const g = await c.env.DB.prepare(`${GROUP_SELECT} WHERE g.id = ?`).bind(user.id, id).first<GroupRow>();
  if (!g) fail(404, "Group not found");
  const isAdmin = user.role === "admin";
  if (need === "member" && !g.my_role && !isAdmin) fail(404, "Group not found");
  if (need === "owner" && g.my_role !== "owner" && !isAdmin) fail(403, "Only group owners can do that");
  return g;
}

api.get("/groups", async (c) => {
  const user = c.get("user");
  const all = c.req.query("all") === "1" && user.role === "admin";
  const { results } = await c.env.DB.prepare(
    `${GROUP_SELECT} ${all ? "" : "WHERE me.user_id IS NOT NULL"} ORDER BY g.name COLLATE NOCASE`,
  )
    .bind(user.id)
    .all<GroupRow>();
  return c.json(results.map(toGroup));
});

const slugRe = /^[a-z0-9][a-z0-9-]{1,39}$/;
const groupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(slugRe, "slug must be 2-40 lowercase letters, numbers or dashes")
    .refine((s) => s !== "me", "slug is reserved"),
  description: z.string().trim().max(300).nullish(),
});

api.post("/groups", async (c) => {
  const input = parse(groupSchema, await jsonBody(c));
  const user = c.get("user");
  const id = randomId();
  const now = Date.now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO groups (id, slug, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(id, input.slug, input.name, input.description ?? null, user.id, now),
      c.env.DB.prepare(
        "INSERT INTO group_members (group_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
      ).bind(id, user.id, now),
    ]);
  } catch (e) {
    if (String(e).includes("UNIQUE")) fail(409, "That slug is taken");
    throw e;
  }
  return c.json(toGroup((await loadGroup(c, id, "member"))), 201);
});

api.get("/groups/:id", async (c) => {
  const g = await loadGroup(c, c.req.param("id"), "member");
  const { results } = await c.env.DB.prepare(
    `SELECT gm.user_id, gm.role, gm.muted, gm.created_at, u.email, u.name, u.picture
     FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?
     ORDER BY gm.role = 'owner' DESC, COALESCE(u.name, u.email) COLLATE NOCASE`,
  )
    .bind(g.id)
    .all<{ user_id: string; role: "owner" | "member"; muted: number; created_at: number; email: string | null; name: string | null; picture: string | null }>();
  const members: GroupMember[] = results.map((m) => ({
    userId: m.user_id,
    email: m.email,
    name: m.name,
    picture: m.picture,
    role: m.role,
    muted: Boolean(m.muted),
    joinedAt: m.created_at,
  }));
  return c.json<Group>({ ...toGroup(g), members });
});

api.patch("/groups/:id", async (c) => {
  const g = await loadGroup(c, c.req.param("id"), "owner");
  const input = parse(groupSchema.partial(), await jsonBody(c));
  try {
    await c.env.DB.prepare("UPDATE groups SET name = ?, slug = ?, description = ? WHERE id = ?")
      .bind(input.name ?? g.name, input.slug ?? g.slug, input.description === undefined ? g.description : input.description, g.id)
      .run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) fail(409, "That slug is taken");
    throw e;
  }
  return c.json(toGroup(await loadGroup(c, g.id, "member")));
});

api.delete("/groups/:id", async (c) => {
  const g = await loadGroup(c, c.req.param("id"), "owner");
  await c.env.DB.prepare("DELETE FROM groups WHERE id = ?").bind(g.id).run();
  return c.json({ ok: true });
});

api.post("/groups/:id/members", async (c) => {
  const g = await loadGroup(c, c.req.param("id"), "owner");
  const input = parse(
    z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["owner", "member"]).optional() }),
    await jsonBody(c),
  );
  const target = await c.env.DB.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE AND status = 'active'")
    .bind(input.email)
    .first<{ id: string }>();
  if (!target) fail(404, "No approved user with that email. They need to sign in to Flare first.");
  await c.env.DB.prepare(
    "INSERT INTO group_members (group_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
  )
    .bind(g.id, target.id, input.role ?? "member", Date.now())
    .run();
  return c.json({ ok: true }, 201);
});

api.patch("/groups/:id/members/:userId", async (c) => {
  const user = c.get("user");
  const targetId = c.req.param("userId");
  const input = parse(
    z.object({ role: z.enum(["owner", "member"]).optional(), muted: z.boolean().optional() }),
    await jsonBody(c),
  );
  if (input.muted !== undefined) {
    if (targetId !== user.id) fail(403, "You can only mute a group for yourself");
    await loadGroup(c, c.req.param("id"), "member");
    await c.env.DB.prepare("UPDATE group_members SET muted = ? WHERE group_id = ? AND user_id = ?")
      .bind(Number(input.muted), c.req.param("id"), user.id)
      .run();
  }
  if (input.role) {
    const g = await loadGroup(c, c.req.param("id"), "owner");
    if (input.role === "member") await assertAnotherOwner(c, g.id, targetId);
    await c.env.DB.prepare("UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?")
      .bind(input.role, g.id, targetId)
      .run();
  }
  return c.json({ ok: true });
});

async function assertAnotherOwner(c: Ctx, groupId: string, leavingUserId: string) {
  const row = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM group_members WHERE group_id = ? AND role = 'owner' AND user_id != ?",
  )
    .bind(groupId, leavingUserId)
    .first<{ n: number }>();
  const isOwner = await c.env.DB.prepare(
    "SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? AND role = 'owner'",
  )
    .bind(groupId, leavingUserId)
    .first();
  if (isOwner && !row?.n) fail(400, "A group needs at least one owner. Promote someone else first, or delete the group.");
}

api.delete("/groups/:id/members/:userId", async (c) => {
  const user = c.get("user");
  const targetId = c.req.param("userId");
  const g = await loadGroup(c, c.req.param("id"), targetId === user.id ? "member" : "owner");
  await assertAnotherOwner(c, g.id, targetId);
  await c.env.DB.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?").bind(g.id, targetId).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Sounds

const MAX_SOUND_BYTES = 1024 * 1024;
const SOUND_TYPES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/ogg", "audio/webm", "audio/aac", "audio/mp4", "audio/x-m4a"];

interface SoundRow {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  r2_key: string;
  content_type: string;
  size: number;
  created_at: number;
  owner_name?: string | null;
}

api.get("/sounds", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare("SELECT * FROM sounds WHERE user_id = ? ORDER BY name COLLATE NOCASE")
    .bind(user.id)
    .all<SoundRow>();
  const sounds: Sound[] = [
    ...BUILTIN_SOUNDS.map((s) => ({ ...s, builtin: true })),
    ...results.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      builtin: false,
      url: `/api/sounds/${s.id}/file`,
      mine: true,
      size: s.size,
    })),
  ];
  return c.json(sounds);
});

api.post("/sounds", async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) fail(400, "file is required");
  if (file.size > MAX_SOUND_BYTES) fail(400, "Sounds must be 1 MB or smaller");
  const type = file.type || "application/octet-stream";
  if (!SOUND_TYPES.includes(type)) fail(400, `Unsupported audio type: ${type}. Use MP3, WAV, OGG, AAC or M4A.`);
  const name = String(form.name || file.name.replace(/\.[^.]+$/, "")).trim().slice(0, 60);
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!slug) fail(400, "Give the sound a name");
  if (BUILTIN_SOUND_SLUGS.has(slug)) fail(409, `"${slug}" is a built-in sound name`);

  const { n } = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM sounds WHERE user_id = ?").bind(user.id).first<{ n: number }>())!;
  if (n >= 25) fail(400, "You can upload at most 25 sounds");

  const id = randomId();
  const r2Key = `sounds/${user.id}/${id}`;
  await c.env.SOUNDS.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: type } });
  try {
    await c.env.DB.prepare(
      "INSERT INTO sounds (id, user_id, slug, name, r2_key, content_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(id, user.id, slug, name, r2Key, type, file.size, Date.now())
      .run();
  } catch (e) {
    await c.env.SOUNDS.delete(r2Key);
    if (String(e).includes("UNIQUE")) fail(409, `You already have a sound called "${slug}"`);
    throw e;
  }
  return c.json<Sound>({ id, slug, name, builtin: false, url: `/api/sounds/${id}/file`, mine: true, size: file.size }, 201);
});

api.delete("/sounds/:id", async (c) => {
  const row = await c.env.DB.prepare("DELETE FROM sounds WHERE id = ? AND user_id = ? RETURNING r2_key")
    .bind(c.req.param("id"), c.get("user").id)
    .first<{ r2_key: string }>();
  if (row) await c.env.SOUNDS.delete(row.r2_key);
  return c.json({ ok: true });
});

/** Any approved user can fetch a sound file, since recipients need to play the sender's sounds. */
api.get("/sounds/:id/file", async (c) => {
  const row = await c.env.DB.prepare("SELECT r2_key, content_type FROM sounds WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ r2_key: string; content_type: string }>();
  const obj = row && (await c.env.SOUNDS.get(row.r2_key));
  if (!row || !obj) fail(404, "Sound not found");
  return new Response(obj.body, {
    headers: { "content-type": row.content_type, "cache-control": "private, max-age=86400, immutable" },
  });
});

// ---------------------------------------------------------------------------
// Admin

api.get("/admin/users", async (c) => {
  requireAdmin(c);
  const { results } = await c.env.DB.prepare(
    `SELECT u.*, (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS device_count,
            (SELECT COUNT(*) FROM apps a WHERE a.user_id = u.id) AS app_count
     FROM users u ORDER BY u.status = 'pending' DESC, u.created_at DESC`,
  ).all<UserRow & { device_count: number; app_count: number }>();
  return c.json(results.map((u) => ({ ...toUser(u), deviceCount: u.device_count, appCount: u.app_count })));
});

api.patch("/admin/users/:id", async (c) => {
  requireAdmin(c);
  const input = parse(
    z.object({ role: z.enum(["user", "admin"]).optional(), status: z.enum(["pending", "active", "disabled"]).optional() }),
    await jsonBody(c),
  );
  const id = c.req.param("id");
  if (id === c.get("user").id && (input.role === "user" || (input.status && input.status !== "active"))) {
    fail(400, "You can't demote or disable yourself");
  }
  const row = await c.env.DB.prepare(
    "UPDATE users SET role = COALESCE(?, role), status = COALESCE(?, status) WHERE id = ? RETURNING *",
  )
    .bind(input.role ?? null, input.status ?? null, id)
    .first<UserRow>();
  if (!row) fail(404, "User not found");
  if (row.status === "disabled") {
    await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
  }
  return c.json(toUser(row));
});
