<img src="assets/icon.svg" width="64" height="64" alt="">

# Flare

Self-hosted push notifications, in the spirit of Pushover. Your scripts and services call an HTTP API, and the
message lands on your phone and browsers and in a feed of recent notifications.

- **Backend:** one Cloudflare Worker ([Hono](https://hono.dev)) on `flare.cubityfir.st`, with D1 for data, R2 for
  custom sounds, and a Durable Object that repeats urgent alerts.
- **Frontend:** a React + [shadcn/ui](https://ui.shadcn.com) PWA served by the same Worker.
- **Delivery:** standard Web Push (VAPID + RFC 8291 encryption, built on WebCrypto with no dependencies). Works on
  Android, desktop browsers, and on iOS 16.4+ once Flare is added to the Home Screen.
- **Auth:** OpenID Connect (authorization code + PKCE) against your own provider. New users wait for an admin's approval.

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

- **Dev sign-in:** in development, `DEV_AUTH` is on, so while no OIDC issuer is configured, **Sign in** goes to a
  local dev login form. It's off in production builds, and the Worker also refuses it on anything but `localhost`.
- **`.dev.vars` only fills declared secrets.** Locally, only bindings declared with `bindings.secret()` are read from
  it. Any other key is ignored, and plain values (`bindings.text()`) come from the config. For a value that differs
  per environment, branch on `dev` in the config.
- **Local D1 has a fixed ID.** In development, D1 uses a placeholder ID, because
  `cf d1 migrations apply --local` only accepts UUIDs.

Other scripts:

- `npm test`: checks the Web Push crypto against a reference implementation.
- `npm run typecheck`: runs `cf workers types`, then `tsc`. Types are inferred from `cloudflare.config.ts` into
  `.cloudflare/types`.
- `npm run preview`: serves the production build locally.
- `node scripts/gen-icons.mjs`: regenerates the PWA icons.

## Temporary password sign-in (until OIDC is ready)

Production currently uses a temporary sign-in at `/auth/password`.

- It signs in as the first `ADMIN_EMAILS` address, using the `ADMIN_LOGIN_PASSWORD` secret (kept in the gitignored
  `.prod.secrets`).
- It switches itself off as soon as `OIDC_ISSUER` and `OIDC_CLIENT_ID` are set.
- Your first OIDC sign-in with the same verified email takes over that account, so apps, keys, groups and devices
  carry over.
- Once OIDC works, delete the `ADMIN_LOGIN_PASSWORD` line from `cloudflare.config.ts`.

## Connecting the OIDC provider

Register Flare as a client with:

- **Redirect URIs:** `https://flare.cubityfir.st/auth/callback` (plus `http://localhost:5173/auth/callback` for dev)
- **Post-logout redirect URI:** `https://flare.cubityfir.st`
- **Grant:** authorization code with PKCE (S256). The client can be public or confidential.
- **Scopes:** `openid email profile`. `email` should be present in the ID token or from userinfo.

Then set `OIDC_ISSUER` and `OIDC_CLIENT_ID` in `cloudflare.config.ts`. If the client is confidential, also uncomment
`OIDC_CLIENT_SECRET: bindings.secret()` there and set the secret. The provider must serve
`/.well-known/openid-configuration`.

Approval works like this:

- New users start as **pending**, and an admin approves them on the Users page.
- Emails in `ADMIN_EMAILS` become admins automatically. The `email_verified` claim must not be `false`.
- To auto-approve users by claim, set `OIDC_ACCESS_CLAIM` and `OIDC_ACCESS_VALUE` (for example `groups` / `flare`).

## Deploying

Pushes to `main` deploy automatically through **Cloudflare Workers Builds**. The repo is connected to the `flare`
Worker under Settings → Builds, and builds run on Node 24 (`.node-version`).

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx cf deploy --prebuilt` |
| Branch | `main` |

Secrets live on the Worker, not in the repo, so builds never need them:

- `SESSION_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `ADMIN_EMAILS`
- `ADMIN_LOGIN_PASSWORD`

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
  routes/          auth (OIDC), api (session/web UI), v1 (API keys + Pushover compat)
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
