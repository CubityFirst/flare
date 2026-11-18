// Generates a VAPID key pair for Web Push.
// Both halves are secrets (see cloudflare.config.ts): put them in .dev.vars locally, and in
// .prod.secrets for `cf deploy --secrets-file` (or set with `cf workers secrets update`).
// Use a different pair for each environment.
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = b64url(await crypto.subtle.exportKey("raw", pair.publicKey));
const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
