import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFcmCache, fitPayload, sendFcm } from "../worker/lib/fcm";

/** Runs the FCM sender against a fake Google token endpoint and FCM API. */

let publicKey: CryptoKey;
let env: Env;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  publicKey = pair.publicKey;
  const pkcs8 = Buffer.from((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer).toString("base64");
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  env = {
    FCM_SERVICE_ACCOUNT: JSON.stringify({
      type: "service_account",
      project_id: "flare-test",
      client_email: "fcm@flare-test.iam.gserviceaccount.com",
      private_key: pem,
      token_uri: "https://oauth2.googleapis.com/token",
    }),
  } as unknown as Env;
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeGoogle(fcmResponse: () => Response) {
  const sent: { url: string; auth: string | null; body: any }[] = [];
  let tokenRequests = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url === "https://oauth2.googleapis.com/token") {
      tokenRequests++;
      const form = new URLSearchParams(await req.text());
      expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      const [h, c, s] = form.get("assertion")!.split(".");
      const ok = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        Buffer.from(s, "base64url"),
        new TextEncoder().encode(`${h}.${c}`),
      );
      const claims = JSON.parse(Buffer.from(c, "base64url").toString());
      if (!ok || claims.scope !== "https://www.googleapis.com/auth/firebase.messaging") return json({ error: "invalid_grant" }, 400);
      return json({ access_token: "ya29.test", expires_in: 3600 });
    }
    sent.push({ url: req.url, auth: req.headers.get("authorization"), body: await req.json() });
    return fcmResponse();
  });
  vi.stubGlobal("fetch", fetchMock);
  return { sent, tokenRequests: () => tokenRequests };
}

describe("FCM sender", () => {
  beforeEach(() => clearFcmCache());
  afterEach(() => vi.unstubAllGlobals());

  it("signs in with the service account and sends a data-only message", async () => {
    const g = fakeGoogle(() => json({ name: "projects/flare-test/messages/1" }));
    const payload = { v: 1, type: "message", title: "Hi", body: "Hello", priority: 2 };
    const r = await sendFcm(env, "tok_123", payload, { highPriority: true, ttl: 60, collapseKey: "urgent-r1" });
    expect(r).toEqual({ ok: true });
    expect(g.sent[0].url).toBe("https://fcm.googleapis.com/v1/projects/flare-test/messages:send");
    expect(g.sent[0].auth).toBe("Bearer ya29.test");
    expect(g.sent[0].body.message).toEqual({
      token: "tok_123",
      data: { flare: JSON.stringify(payload) },
      android: { priority: "HIGH", ttl: "60s", collapse_key: "urgent-r1" },
    });
    expect(g.sent[0].body.message.notification).toBeUndefined();

    // The access token is reused.
    await sendFcm(env, "tok_123", payload, { highPriority: false });
    expect(g.tokenRequests()).toBe(1);
    expect(g.sent[1].body.message.android.priority).toBe("NORMAL");
  });

  it("reports an unregistered token as gone", async () => {
    fakeGoogle(() =>
      json(
        {
          error: {
            code: 404,
            status: "NOT_FOUND",
            message: "Requested entity was not found.",
            details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }],
          },
        },
        404,
      ),
    );
    const r = await sendFcm(env, "tok_old", { body: "x" }, { highPriority: true });
    expect(r).toMatchObject({ ok: false, gone: true });
  });

  it("keeps the device on a transient error", async () => {
    fakeGoogle(() => json({ error: { code: 503, status: "UNAVAILABLE", message: "try later" } }, 503));
    const r = await sendFcm(env, "tok_123", { body: "x" }, { highPriority: true });
    expect(r).toMatchObject({ ok: false, gone: false });
  });

  it("shortens long bodies to fit FCM's 4 KB data limit", () => {
    const out = fitPayload({ title: "t", body: "é".repeat(3000) });
    expect(new TextEncoder().encode(out).byteLength).toBeLessThanOrEqual(3800);
    expect(JSON.parse(out).body.endsWith("…")).toBe(true);
  });

  it("does nothing without a service account", async () => {
    const r = await sendFcm({} as Env, "tok", { body: "x" }, { highPriority: true });
    expect(r.ok).toBe(false);
  });
});
