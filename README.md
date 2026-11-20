<img src="assets/icon.svg" width="64" height="64" alt="">

# Flare

Self-hosted push notifications, in the spirit of Pushover. Your scripts and services call an HTTP API, and the
message lands on your phone and browsers and in a feed of recent notifications.

- **Backend:** one Cloudflare Worker ([Hono](https://hono.dev)) on `flare.cubityfir.st`, with D1 for data, R2 for
  custom sounds, and a Durable Object that repeats urgent alerts.
- **Frontend:** a React + [shadcn/ui](https://ui.shadcn.com) PWA served by the same Worker.
- **Delivery:** standard Web Push (VAPID + RFC 8291 encryption, built on WebCrypto with no dependencies). Works on
  Android, desktop browsers, and on iOS 16.4+ once Flare is added to the Home Screen.
- **Auth:** "Sign in with cubityfir.st", an OpenID Connect provider, via [openid-client](https://github.com/panva/openid-client)
  (authorization code + PKCE). Admin rights come from the provider's `roles` claim. Other new users wait for an admin's
  approval.

## Features

| Feature | How it works |
| --- | --- |
| Feed | Per-user history with unread state, deep links from notifications, mark read/unread, delete, and app-icon badges. |
| API keys | Each user creates **apps** (one per service), and each app gets up to 10 revocable API keys. Keys are stored as SHA-256 hashes and shown only once. |
| Priorities | `-2` feed only · `-1` quiet · `0` normal · `1` high (stays on screen) · `2` urgent. |
| Urgent alerts | Priority 2 repeats every `retry` seconds (min 30) until any recipient acknowledges it or `expire` (max 3 h) passes. Recipients acknowledge from the notification's action button or the feed. Senders get a receipt to poll or cancel, plus an optional HTTPS `callback`. |
| Groups | `to: "group:oncall"` reaches every member. Owners manage membership, and members can mute a group (it still appears in their feed, but no push). |
| Sounds | 7 built-in synthesised sounds plus per-user uploads (R2, ≤ 1 MB). Pick one per message or set a default per app. |
| Pushover compatibility | `POST /1/messages.json` accepts Pushover's fields, so Home Assistant, Uptime Kuma and other Pushover integrations can point at Flare. |

**Sound limitation:** Web Push can't choose the sound for background notifications, so the OS default plays. Flare
plays the selected sound when the app is open. Real custom sounds (and iOS critical alerts) need a native app. The
delivery code sits in `worker/lib/push.ts` so a native APNs/FCM channel can be added beside Web Push later.

## Sending

```sh
curl https://flare.cubityfir.st/api/v1/messages \
  -H "Authorization: Bearer $FLARE_KEY" \
  -d title="Backup finished" -d message="Nightly backup completed in 4m 12s"
```

JSON works too. Fields: `message`, `title`, `to` (`me` by default, or `group:<slug>`, `user:<email>`, or a list),
`priority`, `sound`, `url`, `url_title`, `html`, `ttl`, `retry`, `expire` and `callback`. The full reference is on the
**API docs** page in the app.

Who you can reach:

- yourself;
- groups you belong to;
- people you share a group with.

Admins can reach anyone.

## Local development

Flare uses Cloudflare's [`cf` CLI](https://github.com/cloudflare/cf) and is configured in
[`cloudflare.config.ts`](cloudflare.config.ts), not `wrangler.jsonc`. `cf dev` runs Vite with
`@cloudflare/vite-plugin` 2.x, so you get React hot reload, instant Worker reloads, and an automatic restart when
the config changes. `cf`, the Vite plugin 2.x, and `@cloudflare/config` are all release candidates at the time of
writing.

```sh
npm install
cp .dev.vars.example .dev.vars        # then fill it in:
npm run vapid                         #   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
                                      #   SESSION_SECRET: any long random string
npm run db:migrate:local              # local state lives in .cloudflare/state
npm run dev                           # cf dev → http://localhost:5173
```

The config is a function of the mode: `development` under `cf dev`, `production` under `cf build` / `cf deploy`.

- **Sign-in:** with `OIDC_CLIENT_SECRET` in `.dev.vars`, local dev uses the real provider. The callback
  `http://localhost:5173/auth/callback` is registered, and server-side OIDC requests go to the public issuer URL,
  because the provider's Worker isn't running locally. Without the secret, **Sign in** goes to a local dev login
  form instead. That form is off in production builds, and the Worker refuses it on anything but `localhost`.
- **`.dev.vars` only fills declared secrets.** Locally, only bindings declared with `bindings.secret()` are read from
  it. Any other key is ignored, and plain values (`bindings.text()`) come from the config. For a value that differs
  per environment, branch on `dev` in the config.
- **Local D1 has a fixed ID.** In development, D1 uses a placeholder ID, because
  `cf d1 migrations apply --local` only accepts UUIDs.

Other scripts:

- `npm test`: checks the Web Push crypto against a reference implementation, and runs the OIDC flow against a
  fake provider. Tampered signatures, nonces, audiences, state and PKCE verifiers must be rejected.
- `npm run typecheck`: runs `cf workers types`, then `tsc`. Types are inferred from `cloudflare.config.ts` into
  `.cloudflare/types`.
- `npm run preview`: serves the production build locally.
- `node scripts/gen-icons.mjs`: regenerates the PWA icons.

## Sign in with cubityfir.st

Flare is an OIDC client of `https://auth.cubityfir.st`, using openid-client. The flow is authorization code with
PKCE S256, `state` and `nonce`.

- **Login and ID token:** the ID token is verified against the provider's JWKS (signature, `iss`, `aud`, `exp` and
  `nonce`). Flare then starts its own 30-day session for the user, keyed on `(iss, sub)` and not tied to the
  1-hour token lifetime.
- **Roles:** each sign-in sets the user's role from the `roles` claim. `admin` there means admin in Flare, and
  admins are approved automatically. Everyone else waits for approval on the Users page, unless
  `OIDC_ACCESS_CLAIM` / `OIDC_ACCESS_VALUE` auto-approve them (e.g. `roles` / `user`).
- **Sign-out:** clears the Flare session, then redirects to the provider's `end_session_endpoint` with
  `id_token_hint` and `post_logout_redirect_uri`.
- **Service binding:** in production, server-side requests to the issuer (discovery, JWKS, token) go through the
  `OIDC` service binding to the provider's Worker, `cubityfirst-auth`, instead of the public URL. Only browser
  redirects use `auth.cubityfir.st`.

The client (`OIDC_CLIENT_ID` in `cloudflare.config.ts`) is registered with `scripts/oidc-client.mjs`. Its metadata
lists the exact callback and post-logout URLs:

| | |
| --- | --- |
| Redirect URIs | `https://flare.cubityfir.st/auth/callback`, `http://localhost:5173/auth/callback` |
| Post-logout redirect URIs | `https://flare.cubityfir.st/`, `http://localhost:5173/` |
| Client authentication | `client_secret_basic` |

Registration wrote the credentials to the gitignored `.oidc.secrets`, and the client secret also to `.prod.secrets`
and `.dev.vars`. **Back up `.oidc.secrets`.** Its registration access token is the only way to change the client.

- To check the current registration, run `node scripts/oidc-client.mjs show`.
- To change URLs, edit `METADATA` in the script, then run `node scripts/oidc-client.mjs update`.
- If the secret leaks, revoke it at `https://auth.cubityfir.st/oauth/client-secret/revoke` (HTTP Basic
  `client_id:client_secret`) and ask for a new one.

## Deploying

Pushes to `main` deploy automatically through **Cloudflare Workers Builds**. The repo is connected to the `flare`
Worker under Settings → Builds, and builds run on Node 24 (`.node-version`).

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx cf deploy --prebuilt` |
| Branch | `main` |

Secrets live on the Worker, not in the repo, so builds never need them:

- `OIDC_CLIENT_SECRET`
- `SESSION_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

To change one, run `npx cf workers secrets update <NAME> --worker flare`.

Schema changes aren't applied by builds. After merging a new file in `migrations/`, run
`npm run db:migrate:remote`.

### Setting up from scratch

```sh
npx cf auth login
npm run vapid                       # a separate key pair for production
# Put the secrets listed above in .prod.secrets (.env format, gitignored)
npm run deploy -- --secrets-file .prod.secrets   # first deploy: provisions D1 + R2
npx cf d1 list                                   # find the new database's ID
```

Then:

1. Pin that ID in `cloudflare.config.ts` and in the `db:migrate:remote` script.
2. Run `npm run db:migrate:remote`.
3. Connect the repo under the Worker's Settings → Builds.

The `domains` entry binds the custom domain `flare.cubityfir.st`. A daily cron deletes messages older than
`RETENTION_DAYS`, and expired sessions.

## Layout

```
cloudflare.config.ts  Worker config: bindings, secrets, domain, cron, assets
worker/            Cloudflare Worker
  routes/          auth (OIDC sign-in/out), api (session/web UI), v1 (API keys + Pushover compat)
  lib/             webpush, oidc, send pipeline, receipts, sessions
  durable/         UrgentAlert Durable Object (repeat timer)
migrations/        D1 schema
shared/            types shared by Worker and frontend
src/               React app (pages/, components/ui = shadcn)
public/sw.js       service worker: shows notifications, Acknowledge action
```

## Not done yet

- A native app, for custom background sounds and critical alerts
- Rate limiting per key
- Quiet hours
- Attachments and images
- Per-device priority filters
