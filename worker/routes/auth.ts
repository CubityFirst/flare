import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import type { AppEnv, Ctx, UserRow } from "../lib/context";
import { randomId, signValue, verifySignedValue } from "../lib/encoding";
import {
  endSessionUrl,
  finishLogin,
  hasAccessClaim,
  type LoginFlow,
  type OidcIdentity,
  oidcConfigured,
  startLogin,
} from "../lib/oidc";
import { createSession, destroySession } from "../lib/session";

const FLOW_COOKIE = "flare_oidc";

export const auth = new Hono<AppEnv>();

function safeReturnTo(value: string | undefined | null) {
  // Only allow same-origin relative paths.
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
}

/**
 * Users signed in with the temporary admin password before OIDC existed. Their account is
 * adopted by the first OIDC sign-in from a provider admin with the same verified email, so
 * apps, keys, groups and devices carry over. From then on the account is keyed on `sub`.
 */
const BOOTSTRAP_ISS = "bootstrap";

/**
 * Creates or updates the user for a verified identity, keyed on (iss, sub).
 * The role mirrors the provider's `roles` claim on every sign-in, so admin rights are
 * granted and revoked at the provider. Admins are approved automatically, as are users with
 * the configured access claim; everyone else starts as `pending` until an admin approves.
 */
export async function upsertUser(env: Env, id: OidcIdentity): Promise<UserRow> {
  const now = Date.now();
  const role = id.roles.includes("admin") ? "admin" : "user";
  const autoApprove = role === "admin" || hasAccessClaim(env, id.claims);

  let existing = await env.DB.prepare("SELECT * FROM users WHERE oidc_iss = ? AND oidc_sub = ?")
    .bind(id.iss, id.sub)
    .first<UserRow>();

  if (!existing && role === "admin" && id.email && id.emailVerified) {
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
    role,
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
    return errorPage(c, "Sign-in isn't configured.", 503);
  }
  let login: Awaited<ReturnType<typeof startLogin>>;
  try {
    login = await startLogin(c.env, returnTo);
  } catch (e) {
    console.error("OIDC discovery failed", e);
    return errorPage(c, "Couldn't reach the identity provider.", 503);
  }
  setCookie(c, FLOW_COOKIE, await signValue(JSON.stringify(login.flow), c.env.SESSION_SECRET), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/auth",
    maxAge: 600,
  });
  return c.redirect(login.url);
});

auth.get("/callback", async (c) => {
  const cookie = getCookie(c, FLOW_COOKIE);
  deleteCookie(c, FLOW_COOKIE, { path: "/auth" });
  const error = c.req.query("error");
  if (error) return errorPage(c, `The identity provider returned: ${c.req.query("error_description") ?? error}`);

  const raw = cookie ? await verifySignedValue(cookie, c.env.SESSION_SECRET) : null;
  if (!raw) return errorPage(c, "Your sign-in session expired. Please try again.");
  const flow = JSON.parse(raw) as LoginFlow;

  let identity: OidcIdentity;
  try {
    identity = await finishLogin(c.env, new URL(c.req.url), flow);
  } catch (e) {
    console.error("OIDC callback failed", e);
    return errorPage(c, "Couldn't verify your sign-in with the identity provider.", 500);
  }
  // No email or name in logs; sub is the stable ID.
  const { sub, aud, amr, auth_time, sid, roles } = identity.claims;
  console.log("OIDC sign-in verified", { sub, aud, roles, amr, auth_time, sid });

  const user = await upsertUser(c.env, identity);
  if (user.status === "disabled") return errorPage(c, "Your account has been disabled.", 403);
  await createSession(c, user.id, identity.idToken);
  return c.redirect(safeReturnTo(flow.returnTo));
});

/** Ends the Flare session, then returns the provider's end-session URL for the browser. */
auth.post("/logout", async (c) => {
  const idToken = await destroySession(c);
  let redirect: string | null = null;
  if (oidcConfigured(c.env)) {
    redirect = await endSessionUrl(c.env, idToken).catch((e) => {
      console.error("OIDC end-session URL failed", e);
      return null;
    });
  }
  return c.json({ ok: true, redirect });
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
    roles: form.admin ? ["admin"] : [],
    claims: {},
    idToken: null,
  });
  await c.env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(user.id).run();
  await createSession(c, user.id);
  return c.redirect(safeReturnTo(String(form.returnTo ?? "/")));
});
