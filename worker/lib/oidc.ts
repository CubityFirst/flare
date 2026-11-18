import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { b64urlEncode, randomBytes, utf8 } from "./encoding";

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
}

let cached: { issuer: string; at: number; discovery: Discovery; jwks: ReturnType<typeof createRemoteJWKSet> } | null =
  null;

/** Only set for confidential clients, so it isn't declared in cloudflare.config.ts by default. */
function clientSecret(env: Env): string | undefined {
  return (env as Env & { OIDC_CLIENT_SECRET?: string }).OIDC_CLIENT_SECRET || undefined;
}

export function oidcConfigured(env: Env): boolean {
  return Boolean(env.OIDC_ISSUER && env.OIDC_CLIENT_ID);
}

export async function getDiscovery(env: Env) {
  const issuer = env.OIDC_ISSUER.replace(/\/$/, "");
  if (cached && cached.issuer === issuer && Date.now() - cached.at < 3600_000) return cached;
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  const discovery = (await res.json()) as Discovery;
  cached = { issuer, at: Date.now(), discovery, jwks: createRemoteJWKSet(new URL(discovery.jwks_uri)) };
  return cached;
}

export function redirectUri(env: Env, requestUrl: string): string {
  // Use the request origin so local dev (localhost) and production both work.
  const origin = new URL(requestUrl).origin;
  return `${origin || env.APP_URL}/auth/callback`;
}

export async function pkcePair() {
  const verifier = b64urlEncode(randomBytes(32));
  const challenge = b64urlEncode(await crypto.subtle.digest("SHA-256", utf8(verifier)));
  return { verifier, challenge };
}

export async function buildAuthorizationUrl(
  env: Env,
  params: { redirectUri: string; state: string; nonce: string; challenge: string },
) {
  const { discovery } = await getDiscovery(env);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.OIDC_CLIENT_ID);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", env.OIDC_SCOPES || "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface OidcIdentity {
  iss: string;
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  claims: JWTPayload & Record<string, unknown>;
}

export async function exchangeCode(
  env: Env,
  params: { code: string; redirectUri: string; verifier: string; nonce: string },
): Promise<OidcIdentity> {
  const { discovery, jwks } = await getDiscovery(env);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.verifier,
    client_id: env.OIDC_CLIENT_ID,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  const secret = clientSecret(env);
  if (secret) {
    const methods = discovery.token_endpoint_auth_methods_supported ?? ["client_secret_basic"];
    if (methods.includes("client_secret_basic")) {
      const enc = (s: string) => encodeURIComponent(s);
      headers.authorization = `Basic ${btoa(`${enc(env.OIDC_CLIENT_ID)}:${enc(secret)}`)}`;
    } else {
      body.set("client_secret", secret);
    }
  }

  const res = await fetch(discovery.token_endpoint, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const tokens = (await res.json()) as { id_token?: string; access_token?: string };
  if (!tokens.id_token) throw new Error("Token response had no id_token");

  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: discovery.issuer,
    audience: env.OIDC_CLIENT_ID,
  });
  if (payload.nonce !== params.nonce) throw new Error("ID token nonce mismatch");
  if (!payload.sub) throw new Error("ID token has no sub");

  let claims = payload as JWTPayload & Record<string, unknown>;
  // Some providers only put profile claims in userinfo.
  if (!claims.email && discovery.userinfo_endpoint && tokens.access_token) {
    const info = await fetch(discovery.userinfo_endpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" },
    });
    if (info.ok) {
      const extra = (await info.json()) as Record<string, unknown>;
      if (extra.sub === payload.sub) claims = { ...extra, ...claims, email: extra.email, name: claims.name ?? extra.name };
    }
  }

  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    iss: discovery.issuer,
    sub: payload.sub,
    email: str(claims.email)?.toLowerCase() ?? null,
    emailVerified: claims.email_verified !== false,
    name: str(claims.name) ?? str(claims.preferred_username),
    picture: str(claims.picture),
    claims,
  };
}

/** Whether the configured access claim (e.g. groups contains "flare") is present. */
export function hasAccessClaim(env: Env, claims: Record<string, unknown>): boolean {
  if (!env.OIDC_ACCESS_CLAIM || !env.OIDC_ACCESS_VALUE) return false;
  const value = claims[env.OIDC_ACCESS_CLAIM];
  if (Array.isArray(value)) return value.includes(env.OIDC_ACCESS_VALUE);
  if (typeof value === "string") return value.split(/[\s,]+/).includes(env.OIDC_ACCESS_VALUE);
  if (typeof value === "boolean") return String(value) === env.OIDC_ACCESS_VALUE;
  return false;
}

export async function endSessionUrl(env: Env, postLogoutRedirect: string): Promise<string | null> {
  const endpoint = await getDiscovery(env)
    .then((d) => d.discovery.end_session_endpoint)
    .catch(() => undefined);
  if (!endpoint) return null;
  const url = new URL(endpoint);
  url.searchParams.set("client_id", env.OIDC_CLIENT_ID);
  url.searchParams.set("post_logout_redirect_uri", postLogoutRedirect);
  return url.toString();
}
