import * as client from "openid-client";

/**
 * OpenID Connect relying party, built on openid-client (authorization code + PKCE S256,
 * with state and nonce). Everything is configured from the issuer's discovery document.
 *
 * Server-side requests to the issuer (discovery, JWKS, token, userinfo) go through the
 * `OIDC` service binding to the provider's Worker, since it lives in the same account and
 * zone. The binding is only declared in production; under `cf dev` the provider Worker
 * isn't running, so requests fall back to the public issuer URL.
 */

/** Only declared for production in cloudflare.config.ts, so it's optional here. */
function oidcBinding(env: Env): Fetcher | undefined {
  return (env as Env & { OIDC?: Fetcher }).OIDC;
}

function clientSecret(env: Env): string | undefined {
  return (env as Env & { OIDC_CLIENT_SECRET?: string }).OIDC_CLIENT_SECRET || undefined;
}

/**
 * The client is confidential, so the secret is required too. Without it (e.g. a fresh
 * checkout with no OIDC_CLIENT_SECRET in .dev.vars), `cf dev` falls back to the dev sign-in.
 */
export function oidcConfigured(env: Env): boolean {
  return Boolean(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && clientSecret(env));
}

/** Registered with the provider byte for byte (see scripts/oidc-client.mjs). */
export const redirectUri = (env: Env) => new URL("/auth/callback", env.APP_URL).href;
export const postLogoutRedirectUri = (env: Env) => new URL("/", env.APP_URL).href;

const CONFIG_TTL = 3600_000;
let cached: { key: string; at: number; config: client.Configuration } | null = null;

/** For tests, which each bring their own fake provider. */
export function clearOidcCache() {
  cached = null;
}

/**
 * Discovers the issuer and returns an openid-client Configuration, cached per isolate for
 * an hour. openid-client refetches the JWKS by itself when it meets an unknown key ID.
 */
export async function oidcConfig(env: Env): Promise<client.Configuration> {
  const issuer = new URL(env.OIDC_ISSUER);
  const secret = clientSecret(env);
  if (!secret) throw new Error("OIDC_CLIENT_SECRET isn't set");
  const key = `${issuer.href}|${env.OIDC_CLIENT_ID}|${secret}`;
  if (cached && cached.key === key && Date.now() - cached.at < CONFIG_TTL) return cached.config;

  const binding = oidcBinding(env);
  const viaBinding: client.CustomFetch = (url, init) =>
    binding && new URL(url).host === issuer.host ? binding.fetch(url, init) : fetch(url, init);

  const config = await client.discovery(issuer, env.OIDC_CLIENT_ID, secret, client.ClientSecretBasic(secret), {
    [client.customFetch]: viaBinding,
    // openid-client skips the ID token signature check by default (the token came straight
    // from the token endpoint over TLS); this turns on JWKS verification of the signature.
    execute: [client.enableNonRepudiationChecks],
  });
  cached = { key, at: Date.now(), config };
  return config;
}

/** The per-login values the callback needs; kept in a signed, short-lived cookie. */
export interface LoginFlow {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

export async function startLogin(env: Env, returnTo: string): Promise<{ url: string; flow: LoginFlow }> {
  const config = await oidcConfig(env);
  const flow: LoginFlow = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    verifier: client.randomPKCECodeVerifier(),
    returnTo,
  };
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri(env),
    scope: env.OIDC_SCOPES,
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: await client.calculatePKCECodeChallenge(flow.verifier),
    code_challenge_method: "S256",
  });
  return { url: url.href, flow };
}

export interface OidcIdentity {
  iss: string;
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  roles: string[];
  claims: Record<string, unknown>;
  /** Kept with the session, only as `id_token_hint` for RP-initiated logout. */
  idToken: string | null;
}

/**
 * Exchanges the authorization code (with the PKCE verifier, authenticating with the client
 * secret) and verifies the ID token: signature against the issuer's JWKS, iss, aud, exp,
 * iat and nonce. Also checks `state` and the RFC 9207 `iss` response parameter.
 */
export async function finishLogin(env: Env, callbackUrl: URL, flow: LoginFlow): Promise<OidcIdentity> {
  const config = await oidcConfig(env);
  // The token request's redirect_uri must equal the one we registered, whatever host the
  // request actually arrived on.
  const current = new URL(redirectUri(env));
  current.search = callbackUrl.search;

  const tokens = await client.authorizationCodeGrant(config, current, {
    pkceCodeVerifier: flow.verifier,
    expectedState: flow.state,
    expectedNonce: flow.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error("Token response had no ID token");

  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    iss: claims.iss,
    sub: claims.sub,
    email: str(claims.email)?.toLowerCase() ?? null,
    emailVerified: claims.email_verified === true,
    name: str(claims.name) ?? str(claims.preferred_username),
    picture: str(claims.picture),
    roles: Array.isArray(claims.roles) ? claims.roles.filter((r): r is string => typeof r === "string") : [],
    claims: { ...claims },
    idToken: tokens.id_token ?? null,
  };
}

/** Whether the configured access claim (e.g. roles contains "user") is present. */
export function hasAccessClaim(env: Env, claims: Record<string, unknown>): boolean {
  if (!env.OIDC_ACCESS_CLAIM || !env.OIDC_ACCESS_VALUE) return false;
  const value = claims[env.OIDC_ACCESS_CLAIM];
  if (Array.isArray(value)) return value.includes(env.OIDC_ACCESS_VALUE);
  if (typeof value === "string") return value.split(/[\s,]+/).includes(env.OIDC_ACCESS_VALUE);
  if (typeof value === "boolean") return String(value) === env.OIDC_ACCESS_VALUE;
  return false;
}

/** RP-initiated logout at the provider, or null if it doesn't offer one. */
export async function endSessionUrl(env: Env, idToken: string | null): Promise<string | null> {
  const config = await oidcConfig(env);
  if (!config.serverMetadata().end_session_endpoint) return null;
  return client.buildEndSessionUrl(config, {
    post_logout_redirect_uri: postLogoutRedirectUri(env),
    ...(idToken && { id_token_hint: idToken }),
  }).href;
}
