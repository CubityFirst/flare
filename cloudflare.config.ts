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
 *   SESSION_SECRET      signs the short-lived OIDC login cookie
 *   VAPID_PUBLIC_KEY    Web Push key pair, from `npm run vapid`. The public half isn't
 *   VAPID_PRIVATE_KEY   sensitive, but storing both as secrets keeps each environment's pair together.
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

				// OIDC provider. The issuer must serve /.well-known/openid-configuration.
				// While these are empty, `cf dev` falls back to the local dev sign-in. To test real
				// OIDC locally, also register http://localhost:5173/auth/callback with the provider.
				OIDC_ISSUER: bindings.text(""),
				OIDC_CLIENT_ID: bindings.text(""),
				OIDC_SCOPES: bindings.text("openid email profile"),
				// Only for confidential clients; public (PKCE-only) clients don't need it.
				// OIDC_CLIENT_SECRET: bindings.secret(),

				// Optional: auto-approve users whose ID token has this claim containing this value
				// (e.g. "groups" / "flare"). Otherwise an admin approves each new user.
				OIDC_ACCESS_CLAIM: bindings.text(""),
				OIDC_ACCESS_VALUE: bindings.text(""),
				// Comma-separated emails that become admins (and are auto-approved) on sign-in.
				// The first one is also the identity used by the temporary password sign-in.
				// A secret in production so the public repo carries no personal email.
				ADMIN_EMAILS: dev ? bindings.text("dev@example.com") : bindings.secret(),

				// Local dev sign-in at /auth/dev-login. Only ever on under `cf dev`, and the
				// Worker additionally refuses it on anything but localhost.
				DEV_AUTH: bindings.text(dev ? "true" : "false"),

				// Production only, until the OIDC provider is ready: a long random password for
				// /auth/password, which signs in as the first ADMIN_EMAILS address. It's ignored
				// once OIDC_ISSUER/OIDC_CLIENT_ID are set; remove this line then.
				...(dev ? {} : { ADMIN_LOGIN_PASSWORD: bindings.secret() }),

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
