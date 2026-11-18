export function b64urlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(input: string): Uint8Array<ArrayBuffer> {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const utf8 = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Random lowercase alphanumeric ID. 20 chars is about 103 bits. */
export function randomId(length = 20): string {
  const bytes = randomBytes(length);
  let out = "";
  // 252 = 7 * 36, so values < 252 map uniformly; re-draw the rest.
  for (let i = 0; i < length; i++) {
    let b = bytes[i];
    while (b >= 252) b = randomBytes(1)[0];
    out += ALPHABET[b % 36];
  }
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** Returns `<base64url(value)>.<base64url(hmac)>`. */
export async function signValue(value: string, secret: string): Promise<string> {
  const data = b64urlEncode(utf8(value));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8(data));
  return `${data}.${b64urlEncode(sig)}`;
}

export async function verifySignedValue(signed: string, secret: string): Promise<string | null> {
  const [data, sig] = signed.split(".");
  if (!data || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), b64urlDecode(sig), utf8(data));
    return ok ? new TextDecoder().decode(b64urlDecode(data)) : null;
  } catch {
    return null;
  }
}
