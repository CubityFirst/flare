import { Platform } from "react-native";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

const userAgent = `FlareAndroid/1 (Android ${Platform.Version})`;

/**
 * Calls the Flare API with the app's bearer session. `x-flare` is the web app's CSRF header;
 * bearer requests don't need it, but sending it keeps every request the same shape.
 */
export function createApi(baseUrl: string, token: string, onUnauthorized: () => void): Api {
  async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(baseUrl + path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "x-flare": "1",
          "user-agent": userAgent,
          ...(body !== undefined && { "content-type": "application/json" }),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, "Can't reach Flare. Check your connection.");
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 401) onUnauthorized();
    if (!res.ok) throw new ApiError(res.status, data?.error ?? `Flare answered ${res.status}`);
    return data as T;
  }
  return {
    get: (path) => request(path),
    post: (path, body) => request(path, "POST", body ?? {}),
    del: (path) => request(path, "DELETE"),
  };
}

/** POSTs without a session (the sign-in code exchange). */
export async function postPublic<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(baseUrl + path, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": userAgent },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach Flare. Check your connection.");
  }
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Flare answered ${res.status}`);
  return data as T;
}
