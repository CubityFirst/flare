<p align="center">
  <img src="assets/readme-header.png" alt="Flare" width="100%">
</p>

Flare sends self-hosted push notifications, in the spirit of Pushover. Your scripts and services call an HTTP API,
and the message lands on your phone and browsers and in a feed of recent notifications.

It runs as one Cloudflare Worker on `flare.cubityfir.st`, serving both the API and a React PWA. There's also an
Android app in `mobile/`. Sign-in is through cubityfir.st.

## Features

- **Feed** of recent notifications with unread state, read/unread and delete.
- **Apps and API keys:** one app per service, each with its own revocable keys.
- **Priorities** from feed-only to urgent. Urgent alerts repeat until someone acknowledges them.
- **Groups** to notify several people at once, with per-member mute.
- **Sounds:** built-in sounds plus your own uploads.
- **Pushover compatible**, so Home Assistant, Uptime Kuma and similar tools can point at Flare.

## Sending

```sh
curl https://flare.cubityfir.st/api/v1/messages \
  -H "Authorization: Bearer $FLARE_KEY" \
  -d title="Backup finished" -d message="Nightly backup completed in 4m 12s"
```

The full API reference is on the **API docs** page in the app.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars   # fill in the secrets (npm run vapid makes the VAPID keys)
npm run db:migrate:local
npm run dev                      # http://localhost:5173
```

Other scripts: `npm test`, `npm run typecheck`, `npm run preview`, and `node scripts/gen-icons.mjs` to regenerate
the icons.

## Android app

Needs JDK 17 and the Android SDK. Put your Firebase `google-services.json` in `mobile/`, then from `mobile/`:

```sh
npm install
npx expo prebuild --platform android
npx expo run:android
```

## Deploying

Pushes to `main` deploy automatically through Cloudflare Workers Builds. Secrets live on the Worker; change one
with `npx cf workers secrets update <NAME> --worker flare`.

Builds don't apply database migrations. After adding a file in `migrations/`, run `npm run db:migrate:remote`.

## Not done yet

- An iOS app
- Rate limiting per key
- Quiet hours
- Attachments and images
- Per-device priority filters
