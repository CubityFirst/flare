import { bindings, defineConfig, exports, triggers } from "cf/config";
// Importing the entrypoint (rather than a path string) lets cf infer the Durable Object types.
import * as entrypoint from "./worker/index.ts" with { type: "cf-worker" };

/**
 * Flare's Worker configuration (cf CLI / @cloudflare/vite-plugin 2.x).
 *
 * `mode` is "development" under `cf dev` and "production" under `cf build` / `cf deploy`.
 * Locally, only *secret* bindings read from `.dev.vars`; text values come from here.
 *
 * Secrets (production: `cf` secrets for the Worker; local: `.dev.vars`):
 *   OIDC_CLIENT_SECRET  the OIDC client secret, from `node scripts/oidc-client.mjs register`
 *   SESSION_SECRET      signs the short-lived OIDC login cookie
 *   VAPID_PUBLIC_KEY    Web Push key pair, from `npm run vapid`. The public half isn't
 *   VAPID_PRIVATE_KEY   sensitive, but storing both as secrets keeps each environment's pair together.
 *
 * Optional secret, deliberately not declared below (cf treats declared secrets as required,
 * and deploys refuse to run without them):
 *   FCM_SERVICE_ACCOUNT Firebase service account key (the JSON file) for pushes to the
 *                       Android app. Without it, only browsers get pushes. Set it with
 *                       `npx cf workers secrets update FCM_SERVICE_ACCOUNT --worker flare`.
 */
/** Local-only D1 ID. Must match the `db:migrate:local` script in package.json. */
const LOCAL_D1_ID = "00000000-0000-4000-8000-00000000f1a3";
/** Production D1 database, provisioned by the first `cf deploy` on 2026-11-18. */
const PROD_D1_ID = "8eb55f66-c864-40ec-ab65-eff42e749d2d";

export default defineConfig(({ mode }) => {
	const dev = mode === "development";

	return {
		worker: {
			name: "flare",
			compatibilityDate: "2026-11-01",
			compatibilityFlags: ["nodejs_compat"],
			entrypoint,
			observability: { enabled: false },

			// The SPA is served from static assets. API, auth and the Pushover-compatible endpoint
			// run in the Worker first; everything else falls back to index.html.
			assets: {
				notFoundHandling: "single-page-application",
				runWorkerFirst: ["/api/*", "/auth/*", "/1/*"],
			},
			domains: ["flare.cubityfir.st"],

			// Daily cleanup of old messages and expired sessions.
			triggers: [triggers.scheduled({ schedule: "17 3 * * *" })],

			env: {
				APP_URL: bindings.text(dev ? "http://localhost:5173" : "https://flare.cubityfir.st"),
				APP_NAME: bindings.text("Flare"),

				// Sign in with cubityfir.st (OIDC, authorization code + PKCE). Configured from the
				// issuer's discovery document. The client is registered with
				// scripts/oidc-client.mjs, which also lists the exact callback URLs.
				OIDC_ISSUER: bindings.text("https://auth.cubityfir.st"),
				OIDC_CLIENT_ID: bindings.text("oidc_b411d778a004b3f1bb4a5989"),
				OIDC_SCOPES: bindings.text("openid profile email roles"),
				// Confidential client. Without it in .dev.vars, `cf dev` uses the dev sign-in instead.
				OIDC_CLIENT_SECRET: bindings.secret(),
				// The provider's Worker, in the same account and zone. Server-side OIDC requests
				// (discovery, JWKS, token) go through this binding instead of the public URL.
				// Not under `cf dev`, where that Worker isn't running: there they use the public URL.
				...(dev ? {} : { OIDC: bindings.worker({ worker: "cubityfirst-auth" }) }),

				// Admin rights come from the provider's `roles` claim ("admin"). Other users wait for
				// an admin's approval, unless their ID token has this claim containing this value
				// (e.g. "roles" / "user" approves everyone the provider knows).
				OIDC_ACCESS_CLAIM: bindings.text(""),
				OIDC_ACCESS_VALUE: bindings.text(""),

				// Local dev sign-in at /auth/dev-login, used when OIDC isn't configured. Only ever
				// on under `cf dev`, and the Worker additionally refuses it on anything but localhost.
				DEV_AUTH: bindings.text(dev ? "true" : "false"),

				SESSION_SECRET: bindings.secret(),
				VAPID_PUBLIC_KEY: bindings.secret(),
				VAPID_PRIVATE_KEY: bindings.secret(),
				VAPID_SUBJECT: bindings.text("mailto:admin@cubityfir.st"),
				RETENTION_DAYS: bindings.text("30"),

				// Production: the database provisioned on first deploy. Apply migrations with
				// `npm run db:migrate:remote -- <this id>`.
				// Development: a fixed placeholder ID, because `cf d1 migrations apply --local`
				// only accepts UUIDs (see the db:migrate:local script). Migrations live in ./migrations.
				DB: bindings.d1({ name: "flare", id: dev ? LOCAL_D1_ID : PROD_D1_ID }),
				SOUNDS: bindings.r2({ name: "flare-sounds" }),
				URGENT: bindings.durableObject({ worker: "flare", exportName: "UrgentAlert" }),
			},
			exports: {
				// Repeats urgent alerts until acknowledged. See worker/durable/urgent.ts.
				UrgentAlert: exports.durableObject({ storage: "sqlite" }),
			},
		},
	};
});
