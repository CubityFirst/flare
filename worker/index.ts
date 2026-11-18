import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./lib/context";
import { api } from "./routes/api";
import { auth } from "./routes/auth";
import { pushoverCompat, v1 } from "./routes/v1";

export { UrgentAlert } from "./durable/urgent";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

// API-key routes are mounted before the session API so its auth middleware doesn't apply.
app.route("/api/v1", v1);
app.route("/api", api);
app.route("/auth", auth);
app.route("/1", pushoverCompat);

async function cleanup(env: Env) {
  const now = Date.now();
  const cutoff = now - Number(env.RETENTION_DAYS || 30) * 86400_000;
  await env.DB.batch([
    // Keep messages with an unexpired urgent receipt even if they're old.
    env.DB.prepare(
      `DELETE FROM messages WHERE (created_at < ? OR (expires_at IS NOT NULL AND expires_at < ?))
       AND id NOT IN (SELECT message_id FROM receipts WHERE acknowledged_at IS NULL AND cancelled_at IS NULL AND expire_at > ?)`,
    ).bind(cutoff, now - 86400_000, now),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
  ]);
}

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanup(env));
  },
} satisfies ExportedHandler<Env>;
