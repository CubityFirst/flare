#!/usr/bin/env node
/**
 * Manages Flare's client registration with the cubityfir.st OIDC provider
 * (RFC 7591/7592 dynamic client registration).
 *
 *   node scripts/oidc-client.mjs register   # once; needs OIDC_REGISTRATION_TOKEN in the environment
 *   node scripts/oidc-client.mjs show       # GET the current registration
 *   node scripts/oidc-client.mjs update     # PUT the metadata below (after changing callback URLs)
 *
 * Credentials never go to stdout. `register` writes them to the gitignored files:
 *   .oidc.secrets   client_id, client_secret, registration_access_token, registration_client_uri
 *   .prod.secrets   OIDC_CLIENT_SECRET (uploaded by `npm run deploy -- --secrets-file .prod.secrets`)
 *   .dev.vars       OIDC_CLIENT_SECRET (local `cf dev`)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ISSUER = "https://auth.cubityfir.st";
const STORE = ".oidc.secrets";

/** Must match what the Worker sends: `${APP_URL}/auth/callback` and `${APP_URL}/`. */
const METADATA = {
  client_name: "Flare",
  redirect_uris: ["https://flare.cubityfir.st/auth/callback", "http://localhost:5173/auth/callback"],
  post_logout_redirect_uris: ["https://flare.cubityfir.st/", "http://localhost:5173/"],
  token_endpoint_auth_method: "client_secret_basic",
};

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

/** Sets KEY=value in an .env-style file, replacing an existing line or appending one. */
function setEnvValue(path, key, value) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else {
    while (lines.length && lines.at(-1) === "") lines.pop();
    lines.push(`${key}=${value}`);
  }
  writeFileSync(path, `${lines.join("\n")}\n`);
}

/** What's safe to print: everything except credentials. */
function publicView(reg) {
  const { client_secret, registration_access_token, ...rest } = reg;
  return rest;
}

async function call(method, url, token, body) {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body && { "content-type": "application/json" }) },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

const command = process.argv[2];

if (command === "register") {
  const token = process.env.OIDC_REGISTRATION_TOKEN;
  if (!token) throw new Error("Set OIDC_REGISTRATION_TOKEN");
  if (readEnvFile(STORE).OIDC_CLIENT_ID) throw new Error(`${STORE} already has a client; use show/update`);

  const { status, json } = await call("POST", `${ISSUER}/oauth/register`, token, METADATA);
  if (status !== 201) {
    // Error bodies carry no credentials.
    console.error(`Registration failed (${status}):`, json);
    process.exit(1);
  }
  writeFileSync(
    STORE,
    [
      "# Flare's OIDC client at auth.cubityfir.st. Never commit. The registration access token is the",
      "# only way to change this client (scripts/oidc-client.mjs update), so back this file up.",
      `OIDC_CLIENT_ID=${json.client_id}`,
      `OIDC_CLIENT_SECRET=${json.client_secret}`,
      `OIDC_REGISTRATION_ACCESS_TOKEN=${json.registration_access_token}`,
      `OIDC_REGISTRATION_CLIENT_URI=${json.registration_client_uri}`,
      "",
    ].join("\n"),
  );
  setEnvValue(".prod.secrets", "OIDC_CLIENT_SECRET", json.client_secret);
  setEnvValue(".dev.vars", "OIDC_CLIENT_SECRET", json.client_secret);
  console.log("Registered:", publicView(json));
} else if (command === "show" || command === "update") {
  const store = readEnvFile(STORE);
  if (!store.OIDC_REGISTRATION_CLIENT_URI) throw new Error(`No registration in ${STORE}`);
  const { status, json } =
    command === "show"
      ? await call("GET", store.OIDC_REGISTRATION_CLIENT_URI, store.OIDC_REGISTRATION_ACCESS_TOKEN)
      : await call("PUT", store.OIDC_REGISTRATION_CLIENT_URI, store.OIDC_REGISTRATION_ACCESS_TOKEN, METADATA);
  console.log(status, publicView(json));
  if (status >= 300) process.exit(1);
} else {
  console.error("Usage: node scripts/oidc-client.mjs register|show|update");
  process.exit(1);
}
