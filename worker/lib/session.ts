import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Ctx, UserRow } from "./context";
import { b64urlEncode, randomBytes, sha256Hex } from "./encoding";

export const SESSION_COOKIE = "flare_session";
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const RENEW_WITHIN = 15 * 24 * 3600 * 1000;

function secure(c: Ctx) {
  return new URL(c.req.url).protocol === "https:";
}

/** `idToken` is kept only to send as `id_token_hint` when the user signs out. */
export async function createSession(c: Ctx, userId: string, idToken: string | null = null) {
  const token = b64urlEncode(randomBytes(32));
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, id_token) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      await sha256Hex(token),
      userId,
      now,
      now + SESSION_TTL,
      c.req.header("user-agent")?.slice(0, 300) ?? null,
      idToken,
    )
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL / 1000,
  });
}

export async function loadSessionUser(c: Ctx): Promise<UserRow | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT u.*, s.expires_at AS session_expires_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(id, Date.now())
    .first<UserRow & { session_expires_at: number }>();
  if (!row) return null;

  // Sliding expiry.
  if (row.session_expires_at - Date.now() < RENEW_WITHIN) {
    const expires = Date.now() + SESSION_TTL;
    c.executionCtx.waitUntil(
      c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(expires, id).run(),
    );
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: secure(c),
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL / 1000,
    });
  }
  const { session_expires_at: _, ...user } = row;
  return user;
}

/** Ends the current session and returns its ID token (for the provider's logout), if any. */
export async function destroySession(c: Ctx): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: secure(c) });
  if (!token) return null;
  const row = await c.env.DB.prepare("DELETE FROM sessions WHERE id = ? RETURNING id_token")
    .bind(await sha256Hex(token))
    .first<{ id_token: string | null }>();
  return row?.id_token ?? null;
}
