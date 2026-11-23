import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Ctx, UserRow } from "./context";
import { b64urlEncode, randomBytes, sha256Hex } from "./encoding";

export const SESSION_COOKIE = "flare_session";
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const RENEW_WITHIN = 15 * 24 * 3600 * 1000;
/**
 * The Android app may sit untouched for months while still receiving alerts, and its
 * Acknowledge button needs a live session, so its sessions last longer. They slide too:
 * any API call from the app extends them.
 */
const MOBILE_TTL = 365 * 24 * 3600 * 1000;
const MOBILE_RENEW_WITHIN = 300 * 24 * 3600 * 1000;

function secure(c: Ctx) {
  return new URL(c.req.url).protocol === "https:";
}

async function insertSession(c: Ctx, token: string, userId: string, kind: "web" | "mobile", idToken: string | null) {
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, id_token, kind) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      await sha256Hex(token),
      userId,
      now,
      now + (kind === "mobile" ? MOBILE_TTL : SESSION_TTL),
      c.req.header("user-agent")?.slice(0, 300) ?? null,
      idToken,
      kind,
    )
    .run();
}

/** `idToken` is kept only to send as `id_token_hint` when the user signs out. */
export async function createSession(c: Ctx, userId: string, idToken: string | null = null) {
  const token = b64urlEncode(randomBytes(32));
  await insertSession(c, token, userId, "web", idToken);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL / 1000,
  });
}

/** A session for the Android app. The token is returned once and sent as a bearer token. */
export async function createMobileSession(c: Ctx, userId: string, idToken: string | null): Promise<string> {
  const token = b64urlEncode(randomBytes(32));
  await insertSession(c, token, userId, "mobile", idToken);
  return token;
}

/** The app's bearer token, if the request carries one. */
function bearerToken(c: Ctx): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(c.req.header("authorization") ?? "");
  return m ? m[1] : null;
}

/** Whether the request is authenticated by a bearer token (no cookie, so no CSRF risk). */
export function isBearerRequest(c: Ctx): boolean {
  return bearerToken(c) !== null;
}

export async function loadSessionUser(c: Ctx): Promise<UserRow | null> {
  const bearer = bearerToken(c);
  const token = bearer ?? getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT u.*, s.expires_at AS session_expires_at, s.kind AS session_kind FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(id, Date.now())
    .first<UserRow & { session_expires_at: number; session_kind: string }>();
  if (!row) return null;
  // A bearer token only works for an app session, and the app's token never works as a cookie.
  const mobile = row.session_kind === "mobile";
  if (mobile !== Boolean(bearer)) return null;

  // Sliding expiry.
  if (row.session_expires_at - Date.now() < (mobile ? MOBILE_RENEW_WITHIN : RENEW_WITHIN)) {
    const expires = Date.now() + (mobile ? MOBILE_TTL : SESSION_TTL);
    c.executionCtx.waitUntil(
      c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(expires, id).run(),
    );
    if (!mobile) {
      setCookie(c, SESSION_COOKIE, token, {
        httpOnly: true,
        secure: secure(c),
        sameSite: "Lax",
        path: "/",
        maxAge: SESSION_TTL / 1000,
      });
    }
  }
  const { session_expires_at: _, session_kind: __, ...user } = row;
  return user;
}

/** Ends the current session and returns its ID token (for the provider's logout), if any. */
export async function destroySession(c: Ctx): Promise<string | null> {
  const bearer = bearerToken(c);
  const token = bearer ?? getCookie(c, SESSION_COOKIE);
  if (!bearer) deleteCookie(c, SESSION_COOKIE, { path: "/", secure: secure(c) });
  if (!token) return null;
  const row = await c.env.DB.prepare("DELETE FROM sessions WHERE id = ? RETURNING id_token")
    .bind(await sha256Hex(token))
    .first<{ id_token: string | null }>();
  return row?.id_token ?? null;
}
