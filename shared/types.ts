/** Types shared between the Worker API and the React frontend. */

/**
 * Message priority, matching Pushover's levels:
 * -2 lowest (feed only, no push), -1 quiet (no sound or vibration), 0 normal,
 * 1 high (stays on screen until dismissed), 2 urgent (repeats until acknowledged).
 */
export type Priority = -2 | -1 | 0 | 1 | 2;

export const PRIORITIES: { value: Priority; label: string; description: string }[] = [
  { value: -2, label: "Lowest", description: "Feed only, no notification" },
  { value: -1, label: "Quiet", description: "Notification without sound or vibration" },
  { value: 0, label: "Normal", description: "Standard notification" },
  { value: 1, label: "High", description: "Stays on screen until dismissed" },
  { value: 2, label: "Urgent", description: "Repeats until someone acknowledges it" },
];

export type UserRole = "user" | "admin";
export type UserStatus = "pending" | "active" | "disabled";

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface Me {
  user: User;
  vapidPublicKey: string;
  appName: string;
}

export interface Device {
  id: string;
  name: string;
  /** "webpush" for browsers (the PWA), "fcm" for the Android app. */
  kind: "webpush" | "fcm";
  endpointHost: string;
  /**
   * Full push endpoint (or FCM token), used to recognise the current browser or phone.
   * Only returned to the owner.
   */
  endpoint: string;
  userAgent: string | null;
  enabled: boolean;
  createdAt: number;
  lastPushAt: number | null;
  lastError: string | null;
}

export interface ApiKey {
  id: string;
  label: string | null;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface App {
  id: string;
  name: string;
  description: string | null;
  defaultSound: string | null;
  defaultPriority: Priority;
  createdAt: number;
  keys: ApiKey[];
  messageCount: number;
}

export interface CreatedApiKey {
  key: ApiKey;
  /** The full secret. Only returned once, at creation. */
  secret: string;
}

export interface GroupMember {
  userId: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  role: "owner" | "member";
  muted: boolean;
  joinedAt: number;
}

export interface Group {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  createdAt: number;
  memberCount: number;
  myRole: "owner" | "member" | null;
  muted: boolean;
  members?: GroupMember[];
}

export interface Sound {
  /** Slug used in the `sound` field when sending. */
  slug: string;
  name: string;
  builtin: boolean;
  id?: string;
  description?: string;
  url?: string;
  ownerName?: string | null;
  mine?: boolean;
  size?: number;
}

export interface Receipt {
  id: string;
  acknowledged: boolean;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
  lastSentAt: number | null;
  sentCount: number;
  expired: boolean;
  expireAt: number;
  cancelled: boolean;
  calledBack: boolean;
}

export interface FeedItem {
  id: string; // delivery id
  messageId: string;
  title: string | null;
  body: string;
  html: boolean;
  priority: Priority;
  sound: string | null;
  soundUrl: string | null;
  url: string | null;
  urlTitle: string | null;
  appName: string | null;
  senderName: string | null;
  groupName: string | null;
  createdAt: number;
  readAt: number | null;
  /** When the recipient archived it (swiped it away). Archived items only show in the archive. */
  archivedAt: number | null;
  receipt: Receipt | null;
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
  unread: number;
  /** How many messages are in the archive. */
  archived: number;
}

/** Request body for sending a message (API key or session). */
export interface SendMessageRequest {
  message: string;
  title?: string;
  /** Recipients: "me", "user:<email>", "group:<slug>", a bare email, or a bare group slug. */
  to?: string | string[];
  priority?: Priority;
  sound?: string;
  url?: string;
  url_title?: string;
  html?: boolean;
  /** Seconds after which the message disappears from feeds. */
  ttl?: number;
  /** Urgent only: seconds between repeats (minimum 30). */
  retry?: number;
  /** Urgent only: seconds until it stops repeating (maximum 10800). */
  expire?: number;
  /** Urgent only: HTTPS URL that gets a POST when the alert is acknowledged. */
  callback?: string;
  /** Session sends only: send as this app (must be yours). */
  app_id?: string;
}

export interface SendMessageResponse {
  id: string;
  recipients: number;
  receipt?: string;
}

/** The JSON payload delivered to the service worker inside each Web Push message. */
export interface PushPayload {
  v: 1;
  type: "message";
  deliveryId: string;
  messageId: string;
  title: string;
  body: string;
  priority: Priority;
  sound: string | null;
  soundUrl: string | null;
  url: string | null;
  receipt: string | null;
  /** 1 on the first send of an urgent alert, then 2, 3, … on each repeat. */
  attempt: number;
  ts: number;
}
