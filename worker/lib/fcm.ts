import { b64urlEncode, utf8 } from "./encoding";

/**
 * Firebase Cloud Messaging (HTTP v1) for the Android app.
 *
 * Authenticates with a Google service account (the FCM_SERVICE_ACCOUNT secret holds its JSON
 * key): a self-signed RS256 JWT is exchanged for an OAuth access token, cached per isolate
 * until shortly before it expires.
 *
 * Messages are data-only, so the app's own messaging service builds every notification and
 * can play urgent alerts on the alarm stream.
 */

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface FcmResult {
  ok: boolean;
  /** The token is no longer valid (app uninstalled, data cleared); delete the device. */
  gone?: boolean;
  error?: string;
}

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
/** FCM's limit is 4096 bytes for the whole data payload. */
const MAX_DATA_BYTES = 3800;

function serviceAccount(env: Env): ServiceAccount | null {
  const raw = (env as Env & { FCM_SERVICE_ACCOUNT?: string }).FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    return sa.project_id && sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

export const fcmConfigured = (env: Env) => serviceAccount(env) !== null;

let cachedToken: { key: string; token: string; expiresAt: number } | null = null;

/** For tests. */
export function clearFcmCache() {
  cachedToken = null;
}

async function importKey(pem: string) {
  const der = atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const bytes = Uint8Array.from(der, (ch) => ch.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", bytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  const key = `${sa.client_email}|${sa.private_key.length}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken.token;

  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlEncode(utf8(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64urlEncode(
    utf8(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 })),
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await importKey(sa.private_key), utf8(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${b64urlEncode(signature)}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`FCM auth failed (${res.status}): ${body.error ?? "no token"}`);
  cachedToken = { key, token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

/** Shortens the body until the JSON payload fits in an FCM data message. */
export function fitPayload<T extends { body: string }>(payload: T): string {
  let json = JSON.stringify(payload);
  let body = payload.body;
  while (utf8(json).byteLength > MAX_DATA_BYTES && body.length > 0) {
    body = `${body.slice(0, Math.floor(body.length * 0.8))}…`;
    json = JSON.stringify({ ...payload, body });
  }
  return json;
}

/**
 * Sends one data message. `payload` is the same JSON the web push service worker receives;
 * the app reads it from the `flare` data field.
 */
export async function sendFcm<T extends { body: string }>(
  env: Env,
  token: string,
  payload: T,
  opts: { ttl?: number; highPriority: boolean; collapseKey?: string },
): Promise<FcmResult> {
  const sa = serviceAccount(env);
  if (!sa) return { ok: false, error: "FCM isn't configured" };
  let auth: string;
  try {
    auth = await accessToken(sa);
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        data: { flare: fitPayload(payload) },
        android: {
          priority: opts.highPriority ? "HIGH" : "NORMAL",
          ...(opts.ttl !== undefined && { ttl: `${Math.max(0, Math.floor(opts.ttl))}s` }),
          ...(opts.collapseKey && { collapse_key: opts.collapseKey }),
        },
      },
    }),
  });
  if (res.ok) return { ok: true };

  const err = (await res.json().catch(() => ({}))) as {
    error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
  };
  const code = err.error?.details?.find((d) => d.errorCode)?.errorCode ?? err.error?.status ?? String(res.status);
  // UNREGISTERED: the app was uninstalled or its token rotated. A malformed token is just as dead.
  const gone = code === "UNREGISTERED" || (res.status === 400 && /registration token/i.test(err.error?.message ?? ""));
  if (res.status === 401) cachedToken = null;
  return { ok: false, gone, error: `FCM ${res.status} ${code}`.slice(0, 200) };
}
