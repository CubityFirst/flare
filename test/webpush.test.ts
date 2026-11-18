import { createECDH, createPublicKey, randomBytes, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-expect-error no types published
import ece from "http_ece";
import { b64urlDecode, b64urlEncode } from "../worker/lib/encoding";
import { encryptPayload, vapidAuthorization } from "../worker/lib/webpush";

describe("web push encryption", () => {
  it("produces aes128gcm that a reference implementation decrypts", async () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const message = JSON.stringify({ hello: "world", emoji: "🔥", n: 42 });

    const body = await encryptPayload(
      { p256dh: b64urlEncode(new Uint8Array(ua.getPublicKey())), auth: b64urlEncode(new Uint8Array(auth)) },
      new TextEncoder().encode(message) as Uint8Array<ArrayBuffer>,
    );
    const plain = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: ua, authSecret: auth });
    expect(plain.toString("utf8")).toBe(message);
  });

  it("rejects malformed subscription keys", async () => {
    await expect(encryptPayload({ p256dh: "AAAA", auth: b64urlEncode(randomBytes(16)) }, new Uint8Array(1))).rejects.toThrow();
  });
});

describe("VAPID", () => {
  it("signs an ES256 JWT verifiable with the public key", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
    const pub = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
    const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
    const keys = { publicKey: b64urlEncode(pub), privateKey: jwk.d!, subject: "mailto:test@example.com" };

    const header = await vapidAuthorization("https://push.example.com/abc/def", keys, 1_700_000_000_000);
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(m[2]).toBe(keys.publicKey);
    const [h, c, s] = m[1].split(".");
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)));
    expect(claims).toEqual({ aud: "https://push.example.com", exp: 1_700_000_000 + 43200, sub: keys.subject });

    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33)) }, format: "jwk" });
    const ok = verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(b64urlDecode(s)));
    expect(ok).toBe(true);
  });
});
