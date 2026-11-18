import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

export interface UserRow {
  id: string;
  oidc_iss: string;
  oidc_sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  role: "user" | "admin";
  status: "pending" | "active" | "disabled";
  created_at: number;
  last_login_at: number | null;
}

export interface AppRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  default_sound: string | null;
  default_priority: number;
  created_at: number;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: UserRow;
    /** Set when the request was authenticated with an API key. */
    app?: AppRow;
  };
};

export type Ctx = Context<AppEnv>;

export function fail(status: ContentfulStatusCode, message: string): never {
  throw new HTTPException(status, { message });
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
    fail(400, `${path}${issue.message}`);
  }
  return r.data;
}

export async function jsonBody(c: Ctx): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    fail(400, "Invalid JSON body");
  }
}

/** Accepts JSON, urlencoded or multipart bodies (for Pushover-style clients and curl -F). */
export async function flexibleBody(c: Ctx): Promise<Record<string, unknown>> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json")) return (await jsonBody(c)) as Record<string, unknown>;
  if (type.includes("form")) {
    const form = await c.req.parseBody();
    return Object.fromEntries(Object.entries(form).filter(([, v]) => typeof v === "string"));
  }
  // Fall back to query string params (e.g. GET-less webhooks that POST with no body).
  const text = await c.req.text();
  if (text.trim().startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch {
      fail(400, "Invalid JSON body");
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

export const now = () => Date.now();
