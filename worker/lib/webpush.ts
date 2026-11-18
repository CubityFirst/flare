/**
 * Web Push for Workers using only WebCrypto:
 * - RFC 8291 message encryption (aes128gcm content coding, RFC 8188)
 * - RFC 8292 VAPID authentication (ES256 JWT)
 */
import { b64urlDecode, b64urlEncode, concat, randomBytes, utf8 } from "./encoding";

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string; // base64url, 65-byte uncompressed P-256 point
  auth: string; // base64url, 16 bytes
}

export interface VapidKeys {
  publicKey: string; // base64url, 65-byte uncompressed point
  privateKey: string; // base64url, 32-byte scalar
  subject: string; // mailto: or https: URL
}

export type Urgency = "very-low" | "low" | "normal" | "high";

export interface PushOptions {
  ttl?: number; // seconds the push service should keep trying
  urgency?: Urgency;
  topic?: string; // replaces an undelivered message with the same topic
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** The subscription is dead (404/410) and should be deleted. */
  gone: boolean;
  error?: string;
}

const RECORD_SIZE = 4096;

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/**
 * Encrypts `plaintext` for a subscription. `senderKeys` and `salt` can be passed for
 * deterministic tests; normally they're generated per message.
 */
export async function encryptPayload(
  sub: Pick<PushSubscriptionKeys, "p256dh" | "auth">,
  plaintext: Uint8Array<ArrayBuffer>,
  opts: { senderKeys?: CryptoKeyPair; salt?: Uint8Array<ArrayBuffer> } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublicRaw = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  if (uaPublicRaw.length !== 65) throw new Error("Invalid p256dh key");
  if (authSecret.length < 16) throw new Error("Invalid auth secret");

  const senderKeys =
    opts.senderKeys ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", senderKeys.publicKey)) as ArrayBuffer);
  const uaPublic = await crypto.subtle.importKey("raw", uaPublicRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    // workers-types names this `$public`, but the runtime (and the spec) uses `public`.
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublic } as unknown as SubtleCryptoDeriveKeyAlgorithm, senderKeys.privateKey, 256),
  );

  // RFC 8291 section 3.4
  const keyInfo = concat(utf8("WebPush: info\0"), uaPublicRaw, asPublicRaw);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = opts.salt ?? randomBytes(16);
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  // Single record: plaintext followed by the 0x02 "last record" delimiter.
  if (plaintext.length + 1 + 16 > RECORD_SIZE) throw new Error("Payload too large");
  const padded = concat(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));

  const header = new Uint8Array(16 + 4 + 1 + asPublicRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublicRaw.length;
  header.set(asPublicRaw, 21);
  return concat(header, ciphertext);
}

const vapidKeyCache = new Map<string, Promise<CryptoKey>>();

function importVapidPrivateKey(keys: VapidKeys): Promise<CryptoKey> {
  let p = vapidKeyCache.get(keys.privateKey);
  if (!p) {
    const pub = b64urlDecode(keys.publicKey);
    if (pub.length !== 65 || pub[0] !== 4) throw new Error("Invalid VAPID public key");
    p = crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: b64urlEncode(pub.slice(1, 33)),
        y: b64urlEncode(pub.slice(33, 65)),
        d: keys.privateKey,
        ext: false,
      },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    vapidKeyCache.set(keys.privateKey, p);
  }
  return p;
}

/** Builds the `Authorization: vapid t=…, k=…` header for an endpoint. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    utf8(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })),
  );
  const unsigned = `${header}.${claims}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await importVapidPrivateKey(keys),
    utf8(unsigned),
  );
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

export async function sendWebPush(
  sub: PushSubscriptionKeys,
  payload: string,
  vapid: VapidKeys,
  opts: PushOptions = {},
): Promise<PushResult> {
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = await encryptPayload(sub, utf8(payload));
  } catch (e) {
    return { ok: false, status: 0, gone: true, error: `encrypt: ${(e as Error).message}` };
  }
  const headers: Record<string, string> = {
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(opts.ttl ?? 86400),
    Urgency: opts.urgency ?? "normal",
    Authorization: await vapidAuthorization(sub.endpoint, vapid),
  };
  if (opts.topic) headers.Topic = opts.topic;

  try {
    const res = await fetch(sub.endpoint, { method: "POST", headers, body });
    if (res.ok) return { ok: true, status: res.status, gone: false };
    const text = (await res.text().catch(() => "")).slice(0, 300);
    return {
      ok: false,
      status: res.status,
      gone: res.status === 404 || res.status === 410,
      error: `${res.status} ${text}`.trim(),
    };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: (e as Error).message };
  }
}
