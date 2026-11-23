import type { Priority } from "../../../shared/types";

/** "now", "5m", "3h", "Tue", "12 Mar" — compact, like a messaging app. */
export function shortTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  const d = new Date(ts);
  if (s < 6 * 86400) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function fullTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Messages may be HTML (Pushover-style). The app shows them as plain text. */
export function plainText(body: string, html: boolean): string {
  if (!html) return body;
  return body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

export const PRIORITY_LABEL: Record<Priority, string | null> = {
  [-2]: "Lowest",
  [-1]: "Quiet",
  0: null,
  1: "High",
  2: "Urgent",
};
