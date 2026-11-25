import type {
  App,
  CreatedApiKey,
  Device,
  FeedItem,
  FeedPage,
  Group,
  Me,
  Priority,
  SendMessageRequest,
  SendMessageResponse,
  Sound,
  User,
} from "@shared/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "x-flare": "1", accept: "application/json" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload, credentials: "same-origin" });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
const del = <T = { ok: true }>(path: string) => request<T>("DELETE", path);

export interface PublicConfig {
  appName: string;
  oidc: boolean;
  devAuth: boolean;
  provider: string | null;
}

export type AdminUser = User & { deviceCount: number; appCount: number };

export const api = {
  config: () => get<PublicConfig>("/api/config"),
  me: () => get<Me>("/api/me"),
  logout: () => post<{ ok: true; redirect: string | null }>("/auth/logout"),

  feed: (params: { cursor?: string | null; unread?: boolean; archived?: boolean }) => {
    const q = new URLSearchParams();
    if (params.cursor) q.set("cursor", params.cursor);
    if (params.unread) q.set("unread", "1");
    if (params.archived) q.set("archived", "1");
    return get<FeedPage>(`/api/feed?${q}`);
  },
  feedItem: (id: string) => get<FeedItem>(`/api/feed/${id}`),
  unreadCount: () => get<{ unread: number }>("/api/feed/count"),
  markRead: (id: string) => post(`/api/feed/${id}/read`),
  markUnread: (id: string) => post(`/api/feed/${id}/unread`),
  markAllRead: () => post("/api/feed/read-all"),
  archiveRead: () => post("/api/feed/archive-read"),
  archiveItem: (id: string) => post(`/api/feed/${id}/archive`),
  restoreItem: (id: string) => post(`/api/feed/${id}/restore`),
  deleteForever: (id: string) => del(`/api/feed/archive/${id}`),
  emptyArchive: () => del("/api/feed/archive"),
  acknowledge: (receiptId: string) => post(`/api/receipts/${receiptId}/ack`),

  send: (body: SendMessageRequest) => post<SendMessageResponse>("/api/messages", body),

  devices: () => get<Device[]>("/api/devices"),
  registerDevice: (body: { name: string; subscription: PushSubscriptionJSON }) => post<Device>("/api/devices", body),
  updateDevice: (id: string, body: { name?: string; enabled?: boolean }) => patch<Device>(`/api/devices/${id}`, body),
  deleteDevice: (id: string) => del(`/api/devices/${id}`),

  apps: () => get<App[]>("/api/apps"),
  createApp: (body: { name: string; description?: string | null; defaultSound?: string | null; defaultPriority?: Priority }) =>
    post<{ app: App; secret: string }>("/api/apps", body),
  updateApp: (
    id: string,
    body: { name?: string; description?: string | null; defaultSound?: string | null; defaultPriority?: Priority },
  ) => patch<App>(`/api/apps/${id}`, body),
  deleteApp: (id: string) => del(`/api/apps/${id}`),
  createKey: (appId: string, label: string | null) => post<CreatedApiKey>(`/api/apps/${appId}/keys`, { label }),
  revokeKey: (appId: string, keyId: string) => del(`/api/apps/${appId}/keys/${keyId}`),

  groups: (all = false) => get<Group[]>(`/api/groups${all ? "?all=1" : ""}`),
  group: (id: string) => get<Group>(`/api/groups/${id}`),
  createGroup: (body: { name: string; slug: string; description?: string | null }) => post<Group>("/api/groups", body),
  updateGroup: (id: string, body: { name?: string; slug?: string; description?: string | null }) =>
    patch<Group>(`/api/groups/${id}`, body),
  deleteGroup: (id: string) => del(`/api/groups/${id}`),
  addMember: (id: string, email: string) => post(`/api/groups/${id}/members`, { email }),
  updateMember: (id: string, userId: string, body: { role?: "owner" | "member"; muted?: boolean }) =>
    patch(`/api/groups/${id}/members/${userId}`, body),
  removeMember: (id: string, userId: string) => del(`/api/groups/${id}/members/${userId}`),

  sounds: () => get<Sound[]>("/api/sounds"),
  uploadSound: (file: File, name: string) => {
    const form = new FormData();
    form.set("file", file);
    form.set("name", name);
    return post<Sound>("/api/sounds", form);
  },
  deleteSound: (id: string) => del(`/api/sounds/${id}`),

  adminUsers: () => get<AdminUser[]>("/api/admin/users"),
  updateUser: (id: string, body: { status: User["status"] }) =>
    patch<User>(`/api/admin/users/${id}`, body),
};

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong";
}
