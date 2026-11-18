import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { BUILTIN_SOUNDS } from "@shared/sounds";
import { type AppEnv, type AppRow, type Ctx, fail, flexibleBody, type UserRow } from "../lib/context";
import { sha256Hex } from "../lib/encoding";
import { cancelReceipt, getReceipt, toReceipt } from "../lib/receipts";
import { sendMessage } from "../lib/send";

/**
 * Authenticates an API key from `Authorization: Bearer <key>`, `X-API-Key`, or a `token`
 * field (Pushover style), and sets `app` and `user` (the app owner).
 */
async function authenticateKey(c: Ctx, body?: Record<string, unknown>) {
  const header = c.req.header("authorization");
  const key =
    (header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined) ??
    c.req.header("x-api-key") ??
    (typeof body?.token === "string" ? body.token : undefined) ??
    c.req.query("token");
  if (!key) fail(401, "API key required (Authorization: Bearer <key>)");

  const row = await c.env.DB.prepare(
    `SELECT k.id AS key_id, k.last_used_at, a.*, u.id AS u_id, u.oidc_iss, u.oidc_sub, u.email, u.name AS u_name, u.picture,
            u.role, u.status, u.created_at AS u_created_at, u.last_login_at
     FROM api_keys k JOIN apps a ON a.id = k.app_id JOIN users u ON u.id = a.user_id
     WHERE k.hash = ? AND k.revoked_at IS NULL`,
  )
    .bind(await sha256Hex(key))
    .first<AppRow & { key_id: string; last_used_at: number | null; u_id: string; u_name: string | null; u_created_at: number } & Omit<UserRow, "id" | "name" | "created_at">>();
  if (!row) fail(401, "Invalid API key");
  if (row.status !== "active") fail(403, "The owner of this API key is not active");

  const now = Date.now();
  if (!row.last_used_at || now - row.last_used_at > 60_000) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(now, row.key_id).run(),
    );
  }
  const app: AppRow = {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    default_sound: row.default_sound,
    default_priority: row.default_priority,
    created_at: row.created_at,
  };
  const user: UserRow = {
    id: row.u_id,
    oidc_iss: row.oidc_iss,
    oidc_sub: row.oidc_sub,
    email: row.email,
    name: row.u_name,
    picture: row.picture,
    role: row.role,
    status: row.status,
    created_at: row.u_created_at,
    last_login_at: row.last_login_at,
  };
  c.set("app", app);
  c.set("user", user);
  return { app, user };
}

export const v1 = new Hono<AppEnv>();

v1.post("/messages", async (c) => {
  const body = await flexibleBody(c);
  const { app, user } = await authenticateKey(c, body);
  const res = await sendMessage(c.env, c.executionCtx as ExecutionContext, user, app, body);
  return c.json(res, 201);
});

/** Lets a client check that its key works. */
v1.get("/me", async (c) => {
  const { app, user } = await authenticateKey(c);
  return c.json({ app: { id: app.id, name: app.name }, owner: { email: user.email, name: user.name } });
});

v1.get("/sounds", async (c) => {
  const { user } = await authenticateKey(c);
  const { results } = await c.env.DB.prepare("SELECT slug, name FROM sounds WHERE user_id = ?")
    .bind(user.id)
    .all<{ slug: string; name: string }>();
  return c.json({
    sounds: Object.fromEntries([...BUILTIN_SOUNDS.map((s) => [s.slug, s.name]), ...results.map((s) => [s.slug, s.name])]),
  });
});

async function ownReceipt(c: Ctx, id: string) {
  const { app, user } = await authenticateKey(c);
  const r = await getReceipt(c.env, id);
  // Any key belonging to the same owner can read/cancel, so rotating keys doesn't orphan receipts.
  if (!r || (r.app_id !== app.id && r.sender_user_id !== user.id)) fail(404, "Receipt not found");
  return r;
}

v1.get("/receipts/:id", async (c) => c.json(toReceipt(await ownReceipt(c, c.req.param("id")))));

v1.post("/receipts/:id/cancel", async (c) => {
  const r = await ownReceipt(c, c.req.param("id"));
  const cancelled = await cancelReceipt(c.env, r.id);
  return c.json({ ok: true, cancelled });
});

// ---------------------------------------------------------------------------
// Pushover-compatible endpoint, so existing tools (Home Assistant, Uptime Kuma, scripts)
// can point at https://flare.cubityfir.st/1/messages.json. `token` is a Flare API key and
// `user` is a recipient spec ("me", a group slug or an email).

export const pushoverCompat = new Hono<AppEnv>();

pushoverCompat.onError((err, c) => {
  const status = err instanceof HTTPException ? err.status : 500;
  if (status === 500) console.error(err);
  return c.json({ status: 0, errors: [status === 500 ? "internal error" : err.message], request: crypto.randomUUID() }, status);
});

pushoverCompat.post("/messages.json", async (c) => {
  const body = await flexibleBody(c);
  const { app, user } = await authenticateKey(c, body);
  const res = await sendMessage(c.env, c.executionCtx as ExecutionContext, user, app, body);
  return c.json({ status: 1, request: res.id, ...(res.receipt ? { receipt: res.receipt } : {}) });
});

pushoverCompat.get("/receipts/:file", async (c) => {
  const m = /^([a-z0-9]+)\.json$/.exec(c.req.param("file"));
  if (!m) fail(404, "Not found");
  const r = await ownReceipt(c, m[1]);
  const s = (ms: number | null) => (ms ? Math.floor(ms / 1000) : 0);
  return c.json({
    status: 1,
    acknowledged: r.acknowledged_at ? 1 : 0,
    acknowledged_at: s(r.acknowledged_at),
    acknowledged_by: r.acknowledged_by_name ?? "",
    last_delivered_at: s(r.last_sent_at),
    expired: r.expired_at || Date.now() >= r.expire_at ? 1 : 0,
    expires_at: s(r.expire_at),
    called_back: r.called_back_at ? 1 : 0,
    called_back_at: s(r.called_back_at),
  });
});

pushoverCompat.post("/receipts/:id/cancel.json", async (c) => {
  const r = await ownReceipt(c, c.req.param("id"));
  await cancelReceipt(c.env, r.id);
  return c.json({ status: 1 });
});

pushoverCompat.get("/sounds.json", async (c) => {
  await authenticateKey(c);
  return c.json({ status: 1, sounds: Object.fromEntries(BUILTIN_SOUNDS.map((s) => [s.slug, s.name])) });
});
