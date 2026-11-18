import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import type { AppEnv, Ctx, UserRow } from "../lib/context";
import { b64urlEncode, randomBytes, randomId, signValue, verifySignedValue } from "../lib/encoding";
import {
  buildAuthorizationUrl,
  endSessionUrl,
  exchangeCode,
  hasAccessClaim,
  type OidcIdentity,
  oidcConfigured,
  pkcePair,
  redirectUri,
} from "../lib/oidc";
import { createSession, destroySession } from "../lib/session";

const FLOW_COOKIE = "flare_oidc";

export const auth = new Hono<AppEnv>();

function safeReturnTo(value: string | undefined | null) {
  // Only allow same-origin relative paths.
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
}

function adminEmails(env: Env) {
  return new Set(
    env.ADMIN_EMAILS.split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Creates or updates the user for an OIDC identity. New users start as `pending` unless
 * they're listed in ADMIN_EMAILS or carry the configured access claim. Existing users are
 * promoted to admin or approved by the same rules, never demoted.
 */
export async function upsertUser(env: Env, id: OidcIdentity): Promise<UserRow> {
  const now = Date.now();
  const isAdmin = Boolean(id.email && id.emailVerified && adminEmails(env).has(id.email));
  const autoApprove = isAdmin || hasAccessClaim(env, id.claims);

  let existing = await env.DB.prepare("SELECT * FROM users WHERE oidc_iss = ? AND oidc_sub = ?")
    .bind(id.iss, id.sub)
    .first<UserRow>();

  // First real OIDC sign-in for someone who used the temporary password login: adopt that
  // account (matched by verified email) so their apps, keys, groups and devices carry over.
  if (!existing && id.email && id.emailVerified && id.iss !== BOOTSTRAP_ISS) {
    const placeholder = await env.DB.prepare(
      "SELECT * FROM users WHERE oidc_iss = ? AND email = ? COLLATE NOCASE LIMIT 1",
    )
      .bind(BOOTSTRAP_ISS, id.email)
      .first<UserRow>();
    if (placeholder) {
      await env.DB.prepare("UPDATE users SET oidc_iss = ?, oidc_sub = ? WHERE id = ?")
        .bind(id.iss, id.sub, placeholder.id)
        .run();
      existing = { ...placeholder, oidc_iss: id.iss, oidc_sub: id.sub };
    }
  }

  if (existing) {
    const role = isAdmin ? "admin" : existing.role;
    const status = existing.status === "pending" && autoApprove ? "active" : existing.status;
    await env.DB.prepare(
      "UPDATE users SET email = ?, name = ?, picture = ?, role = ?, status = ?, last_login_at = ? WHERE id = ?",
    )
      .bind(id.email, id.name, id.picture, role, status, now, existing.id)
      .run();
    return { ...existing, email: id.email, name: id.name, picture: id.picture, role, status, last_login_at: now };
  }

  const user: UserRow = {
    id: randomId(),
    oidc_iss: id.iss,
    oidc_sub: id.sub,
    email: id.email,
    name: id.name,
    picture: id.picture,
    role: isAdmin ? "admin" : "user",
    status: autoApprove ? "active" : "pending",
    created_at: now,
    last_login_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO users (id, oidc_iss, oidc_sub, email, name, picture, role, status, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(user.id, user.oidc_iss, user.oidc_sub, user.email, user.name, user.picture, user.role, user.status, now, now)
    .run();
  return user;
}

function errorPage(c: Ctx, message: string, status: 400 | 403 | 500 | 503 = 400) {
  return c.html(
    html`<!doctype html><meta name="viewport" content="width=device-width" /><title>Sign-in error</title>
      <body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
        <h1>Sign-in failed</h1>
        <p>${message}</p>
        <p><a href="/">Back to Flare</a></p>
      </body>`,
    status,
  );
}

auth.get("/login", async (c) => {
  const returnTo = safeReturnTo(c.req.query("returnTo"));
  if (!oidcConfigured(c.env)) {
    if (devAuthAllowed(c)) return c.redirect(`/auth/dev-login?returnTo=${encodeURIComponent(returnTo)}`);
    if (passwordLoginAllowed(c.env)) return c.redirect(`/auth/password?returnTo=${encodeURIComponent(returnTo)}`);
    return errorPage(c, "Sign-in isn't configured yet. Set OIDC_ISSUER and OIDC_CLIENT_ID.", 503);
  }
  const state = b64urlEncode(randomBytes(16));
  const nonce = b64urlEncode(randomBytes(16));
  const { verifier, challenge } = await pkcePair();
  const redirect = redirectUri(c.env, c.req.url);

  let url: string;
  try {
    url = await buildAuthorizationUrl(c.env, { redirectUri: redirect, state, nonce, challenge });
  } catch (e) {
    console.error(e);
    return errorPage(c, "Couldn't reach the identity provider.", 503);
  }
  setCookie(
    c,
    FLOW_COOKIE,
    await signValue(JSON.stringify({ state, nonce, verifier, returnTo, redirect }), c.env.SESSION_SECRET),
    { httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", path: "/auth", maxAge: 600 },
  );
  return c.redirect(url);
});

auth.get("/callback", async (c) => {
  const cookie = getCookie(c, FLOW_COOKIE);
  deleteCookie(c, FLOW_COOKIE, { path: "/auth" });
  const error = c.req.query("error");
  if (error) return errorPage(c, `The identity provider returned: ${c.req.query("error_description") ?? error}`);

  const raw = cookie ? await verifySignedValue(cookie, c.env.SESSION_SECRET) : null;
  if (!raw) return errorPage(c, "Your sign-in session expired. Please try again.");
  const flow = JSON.parse(raw) as { state: string; nonce: string; verifier: string; returnTo: string; redirect: string };
  const code = c.req.query("code");
  if (!code || c.req.query("state") !== flow.state) return errorPage(c, "Invalid sign-in response (state mismatch).");

  let identity: OidcIdentity;
  try {
    identity = await exchangeCode(c.env, { code, redirectUri: flow.redirect, verifier: flow.verifier, nonce: flow.nonce });
  } catch (e) {
    console.error("OIDC exchange failed", e);
    return errorPage(c, "Couldn't verify your sign-in with the identity provider.", 500);
  }

  const user = await upsertUser(c.env, identity);
  if (user.status === "disabled") return errorPage(c, "Your account has been disabled.", 403);
  await createSession(c, user.id);
  return c.redirect(safeReturnTo(flow.returnTo));
});

auth.post("/logout", async (c) => {
  await destroySession(c);
  const origin = new URL(c.req.url).origin;
  return c.json({ ok: true, redirect: oidcConfigured(c.env) ? await endSessionUrl(c.env, origin) : null });
});

// ---------------------------------------------------------------------------
// Temporary password sign-in for production, until the OIDC provider is ready.
// Enabled only while OIDC is unconfigured AND the ADMIN_LOGIN_PASSWORD secret is set.
// It always signs in as the first ADMIN_EMAILS address, never an arbitrary identity, and
// that account is adopted by the first OIDC sign-in with the same verified email.

export const BOOTSTRAP_ISS = "bootstrap";

function adminLoginPassword(env: Env): string | undefined {
  const value = (env as Env & { ADMIN_LOGIN_PASSWORD?: string }).ADMIN_LOGIN_PASSWORD;
  // Refuse weak values outright so a typo can't open the door.
  return value && value.length >= 24 ? value : undefined;
}

export function passwordLoginAllowed(env: Env) {
  return !oidcConfigured(env) && Boolean(adminLoginPassword(env)) && adminEmails(env).size > 0;
}

/** Constant-time comparison via SHA-256 digests (equal length, so no length leak). */
async function passwordMatches(given: string, expected: string) {
  const [a, b] = await Promise.all(
    [given, expected].map(async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))),
  );
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function passwordPage(c: Ctx, returnTo: string, error?: string) {
  return c.html(
    html`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Sign in · Flare</title>
      <body style="font-family:system-ui;max-width:22rem;margin:5rem auto;padding:0 1rem;color-scheme:light dark">
        <h1 style="font-size:1.4rem">Sign in to Flare</h1>
        <p style="opacity:.7;font-size:.9rem">Temporary admin sign-in, used until single sign-on is set up.</p>
        ${error ? html`<p style="color:#dc2626">${error}</p>` : ""}
        <form method="post" style="display:grid;gap:.75rem">
          <input type="hidden" name="returnTo" value="${returnTo}" />
          <label style="display:grid;gap:.25rem">Password
            <input name="password" type="password" required autofocus autocomplete="current-password"
              style="padding:.5rem;font:inherit" /></label>
          <button type="submit" style="padding:.55rem;font:inherit">Sign in</button>
        </form>
      </body>`,
    error ? 401 : 200,
  );
}

auth.get("/password", (c) => {
  if (!passwordLoginAllowed(c.env)) return c.notFound();
  return passwordPage(c, safeReturnTo(c.req.query("returnTo")));
});

auth.post("/password", async (c) => {
  if (!passwordLoginAllowed(c.env)) return c.notFound();
  const form = await c.req.parseBody();
  const returnTo = safeReturnTo(String(form.returnTo ?? "/"));
  if (!(await passwordMatches(String(form.password ?? ""), adminLoginPassword(c.env)!))) {
    console.warn("Failed password sign-in attempt");
    return passwordPage(c, returnTo, "That password isn't right.");
  }
  const email = [...adminEmails(c.env)][0];
  const user = await upsertUser(c.env, {
    iss: BOOTSTRAP_ISS,
    sub: email,
    email,
    emailVerified: true,
    name: null,
    picture: null,
    claims: {},
  });
  if (user.status === "disabled") return errorPage(c, "This account has been disabled.", 403);
  await createSession(c, user.id);
  return c.redirect(returnTo);
});

// ---------------------------------------------------------------------------
// Development sign-in. Only when DEV_AUTH=true AND the request is to localhost,
// so a misconfigured production deploy still can't use it.

function devAuthAllowed(c: Ctx) {
  const host = new URL(c.req.url).hostname;
  return c.env.DEV_AUTH === "true" && (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
}

auth.get("/dev-login", (c) => {
  if (!devAuthAllowed(c)) return c.notFound();
  const returnTo = safeReturnTo(c.req.query("returnTo"));
  return c.html(
    html`<!doctype html><meta name="viewport" content="width=device-width" /><title>Dev sign-in</title>
      <body style="font-family:system-ui;max-width:24rem;margin:4rem auto;padding:0 1rem">
        <h1>Dev sign-in</h1>
        <p style="color:#666">Local development only. This simulates an OIDC login.</p>
        <form method="post" style="display:grid;gap:.75rem">
          <input type="hidden" name="returnTo" value="${returnTo}" />
          <label>Email <input name="email" type="email" required value="dev@example.com" style="width:100%" /></label>
          <label>Name <input name="name" value="Dev User" style="width:100%" /></label>
          <label><input type="checkbox" name="admin" checked /> Admin</label>
          <button type="submit">Sign in</button>
        </form>
      </body>`,
  );
});

auth.post("/dev-login", async (c) => {
  if (!devAuthAllowed(c)) return c.notFound();
  const form = await c.req.parseBody();
  const email = String(form.email ?? "").trim().toLowerCase();
  if (!email) return errorPage(c, "Email required");
  const user = await upsertUser(c.env, {
    iss: "dev",
    sub: email,
    email,
    emailVerified: true,
    name: String(form.name ?? "") || null,
    picture: null,
    claims: {},
  });
  const role = form.admin ? "admin" : "user";
  await c.env.DB.prepare("UPDATE users SET status = 'active', role = ? WHERE id = ?").bind(role, user.id).run();
  await createSession(c, user.id);
  return c.redirect(safeReturnTo(String(form.returnTo ?? "/")));
});
