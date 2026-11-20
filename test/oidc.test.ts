import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearOidcCache, endSessionUrl, finishLogin, oidcConfigured, startLogin } from "../worker/lib/oidc";

/**
 * Runs the real openid-client flow against a fake cubityfir.st provider served through the
 * OIDC service binding, and checks that a tampered ID token, nonce, state or PKCE verifier
 * is rejected.
 */

const ISSUER = "https://auth.cubityfir.st";
const CLIENT_ID = "oidc_test";
const CLIENT_SECRET = "sk_test_secret";
const enc = new TextEncoder();
const b64url = (data: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof data === "string" ? enc.encode(data) : new Uint8Array(data)).toString("base64url");

let signingKey: CryptoKeyPair;
let otherKey: CryptoKeyPair;
let jwk: JsonWebKey;

const rsa = () =>
  crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;

beforeAll(async () => {
  [signingKey, otherKey] = await Promise.all([rsa(), rsa()]);
  jwk = (await crypto.subtle.exportKey("jwk", signingKey.publicKey)) as JsonWebKey;
});

async function signJwt(claims: Record<string, unknown>, key: CryptoKey) {
  const input = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "k1" }))}.${b64url(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(input));
  return `${input}.${b64url(sig)}`;
}

interface Pending {
  challenge: string;
  nonce: string;
  redirectUri: string;
}

/** A minimal provider, reached only via the service binding. */
function fakeProvider(opts: { tamper?: "signature" | "nonce" | "audience" } = {}) {
  const codes = new Map<string, Pending>();
  const requests: string[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const binding = {
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const req = new Request(input, init);
      const url = new URL(req.url);
      requests.push(url.pathname);
      if (url.pathname === "/.well-known/openid-configuration") {
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/oauth/authorize`,
          token_endpoint: `${ISSUER}/oauth/token`,
          jwks_uri: `${ISSUER}/oauth/jwks`,
          end_session_endpoint: `${ISSUER}/oauth/logout`,
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
          authorization_response_iss_parameter_supported: true,
        });
      }
      if (url.pathname === "/oauth/jwks") return json({ keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] });
      if (url.pathname === "/oauth/token") {
        // RFC 6749 §2.3.1: id and secret are form-urlencoded before Basic encoding.
        const basic = atob((req.headers.get("authorization") ?? "").replace(/^Basic /, ""));
        const [id, secret] = basic.split(":").map((s) => decodeURIComponent(s.replace(/\+/g, " ")));
        if (id !== CLIENT_ID || secret !== CLIENT_SECRET) return json({ error: "invalid_client" }, 401);
        const form = new URLSearchParams(await req.text());
        const pending = codes.get(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        const challenge = b64url(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
        if (!pending || challenge !== pending.challenge || form.get("redirect_uri") !== pending.redirectUri) {
          return json({ error: "invalid_grant" }, 400);
        }
        const now = Math.floor(Date.now() / 1000);
        const idToken = await signJwt(
          {
            iss: ISSUER,
            aud: opts.tamper === "audience" ? "someone-else" : CLIENT_ID,
            sub: "usr_123",
            iat: now,
            exp: now + 3600,
            auth_time: now,
            nonce: opts.tamper === "nonce" ? "wrong" : pending.nonce,
            email: "Person@Example.com",
            email_verified: true,
            name: "Test Person",
            picture: "https://auth.cubityfir.st/avatars/usr_123.png",
            roles: ["user", "admin"],
            amr: ["pwd"],
            sid: "sid_1",
          },
          opts.tamper === "signature" ? otherKey.privateKey : signingKey.privateKey,
        );
        return json({ access_token: "at", token_type: "Bearer", expires_in: 3600, id_token: idToken });
      }
      return new Response("not found", { status: 404 });
    },
  };

  /** Plays the browser + provider's authorize endpoint: returns the callback URL. */
  function authorize(authUrl: string, override: { state?: string } = {}) {
    const u = new URL(authUrl);
    expect(u.origin + u.pathname).toBe(`${ISSUER}/oauth/authorize`);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toBe("openid profile email roles");
    const code = crypto.randomUUID();
    codes.set(code, {
      challenge: u.searchParams.get("code_challenge")!,
      nonce: u.searchParams.get("nonce")!,
      redirectUri: u.searchParams.get("redirect_uri")!,
    });
    const cb = new URL(u.searchParams.get("redirect_uri")!);
    cb.searchParams.set("code", code);
    cb.searchParams.set("state", override.state ?? u.searchParams.get("state")!);
    cb.searchParams.set("iss", ISSUER);
    return cb;
  }

  return { binding, authorize, requests };
}

function makeEnv(binding: { fetch: unknown }) {
  return {
    APP_URL: "https://flare.cubityfir.st",
    OIDC_ISSUER: ISSUER,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_CLIENT_SECRET: CLIENT_SECRET,
    OIDC_SCOPES: "openid profile email roles",
    OIDC: binding,
  } as unknown as Env;
}

describe("OIDC sign-in", () => {
  // Server-side requests must never hit the public issuer URL when the binding exists.
  const publicFetch = vi.fn(() => Promise.reject(new Error("public fetch used")));
  vi.stubGlobal("fetch", publicFetch);
  afterEach(() => publicFetch.mockClear());
  beforeEach(() => clearOidcCache());

  it("requires the client secret to count as configured", () => {
    expect(oidcConfigured({ OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: CLIENT_ID } as unknown as Env)).toBe(false);
    expect(oidcConfigured(makeEnv({ fetch() {} }))).toBe(true);
  });

  it("verifies the ID token and returns the identity", async () => {
    const p = fakeProvider();
    const env = makeEnv(p.binding);
    const { url, flow } = await startLogin(env, "/feed");
    expect(new URL(url).searchParams.get("redirect_uri")).toBe("https://flare.cubityfir.st/auth/callback");

    const id = await finishLogin(env, p.authorize(url), flow);
    expect(id).toMatchObject({
      iss: ISSUER,
      sub: "usr_123",
      email: "person@example.com",
      emailVerified: true,
      name: "Test Person",
      roles: ["user", "admin"],
    });
    expect(id.claims).toMatchObject({ aud: CLIENT_ID, amr: ["pwd"], sid: "sid_1" });
    expect(id.idToken).toMatch(/^ey/);
    expect(p.requests).toEqual(expect.arrayContaining(["/.well-known/openid-configuration", "/oauth/token", "/oauth/jwks"]));
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it.each(["signature", "nonce", "audience"] as const)("rejects an ID token with a bad %s", async (tamper) => {
    const p = fakeProvider({ tamper });
    const env = makeEnv(p.binding);
    const { url, flow } = await startLogin(env, "/");
    await expect(finishLogin(env, p.authorize(url), flow)).rejects.toThrow();
  });

  it("rejects a state mismatch", async () => {
    const p = fakeProvider();
    const env = makeEnv(p.binding);
    const { url, flow } = await startLogin(env, "/");
    await expect(finishLogin(env, p.authorize(url, { state: "forged" }), flow)).rejects.toThrow();
  });

  it("rejects a wrong PKCE verifier", async () => {
    const p = fakeProvider();
    const env = makeEnv(p.binding);
    const { url, flow } = await startLogin(env, "/");
    await expect(finishLogin(env, p.authorize(url), { ...flow, verifier: "x".repeat(43) })).rejects.toThrow();
  });

  it("builds the logout URL with id_token_hint and the registered redirect", async () => {
    const env = makeEnv(fakeProvider().binding);
    const url = new URL((await endSessionUrl(env, "the.id.token"))!);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/oauth/logout`);
    expect(url.searchParams.get("id_token_hint")).toBe("the.id.token");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://flare.cubityfir.st/");
  });
});
