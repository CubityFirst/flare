import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEventListener } from "expo";
import { useEffect } from "react";
import { AppState } from "react-native";
import type { FeedItem, FeedPage, Me } from "../../../shared/types";
import FlarePush from "../../modules/flare-push";
import { defaultDeviceName, registerDevice, requestNotificationPermission } from "./push";
import { useApi } from "./session";

export function useMe() {
  const api = useApi();
  return useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/api/me") });
}

export function useFeed() {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ["feed"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<FeedPage>(`/api/feed?limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Archived messages, newest first. */
export function useArchive() {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ARCHIVE,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<FeedPage>(`/api/feed?archived=1&limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor,
  });
}

const FEED = ["feed"] as const;
const ARCHIVE = ["feed", "archived"] as const;

export function useFeedItem(id: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["feed", "item", id],
    queryFn: () => api.get<FeedItem>(`/api/feed/${encodeURIComponent(id)}`),
    // Show the copy from the feed list straight away, then refresh it.
    placeholderData: () =>
      [FEED, ARCHIVE]
        .flatMap((key) => qc.getQueryData<InfiniteData<FeedPage>>(key)?.pages.flatMap((p) => p.items) ?? [])
        .find((i) => i.id === id),
  });
}

/**
 * Updates one item in the feed and archive lists. Returning null takes it out of the lists;
 * the item's own detail query keeps it (with `archived` applied), so an open message stays put.
 */
function patchItem(
  qc: ReturnType<typeof useQueryClient>,
  id: string,
  patch: (i: FeedItem) => FeedItem | null,
  detail: (i: FeedItem) => FeedItem = (i) => patch(i) ?? i,
) {
  for (const key of [FEED, ARCHIVE]) {
    qc.setQueryData<InfiniteData<FeedPage>>(key, (data) =>
      data && {
        ...data,
        pages: data.pages.map((p) => ({
          ...p,
          items: p.items.flatMap((i) => (i.id === id ? (patch(i) ?? []) : [i])),
        })),
      },
    );
  }
  qc.setQueryData<FeedItem>(["feed", "item", id], (i) => (i ? detail(i) : i));
}

export function useFeedActions() {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["feed"] });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/api/feed/${encodeURIComponent(id)}/read`),
    onMutate: (id) => patchItem(qc, id, (i) => ({ ...i, readAt: i.readAt ?? Date.now() })),
  });
  const markUnread = useMutation({
    mutationFn: (id: string) => api.post(`/api/feed/${encodeURIComponent(id)}/unread`),
    onMutate: (id) => patchItem(qc, id, (i) => ({ ...i, readAt: null })),
  });
  // Archive and restore share a scope, so an Undo waits for the archive it reverses.
  const archive = useMutation({
    scope: { id: "feed-archive" },
    mutationFn: (id: string) => api.post(`/api/feed/${encodeURIComponent(id)}/archive`),
    onMutate: (id) =>
      patchItem(qc, id, () => null, (i) => ({ ...i, archivedAt: Date.now(), readAt: i.readAt ?? Date.now() })),
    onSettled: refresh,
  });
  const restore = useMutation({
    scope: { id: "feed-archive" },
    mutationFn: (id: string) => api.post(`/api/feed/${encodeURIComponent(id)}/restore`),
    onMutate: (id) => patchItem(qc, id, () => null, (i) => ({ ...i, archivedAt: null })),
    onSettled: refresh,
  });
  const deleteForever = useMutation({
    mutationFn: (id: string) => api.del(`/api/feed/archive/${encodeURIComponent(id)}`),
    onMutate: (id) => patchItem(qc, id, () => null),
    onSettled: refresh,
  });
  const emptyArchive = useMutation({
    mutationFn: () => api.del("/api/feed/archive"),
    onMutate: () =>
      qc.setQueryData<InfiniteData<FeedPage>>(ARCHIVE, (data) =>
        data && { ...data, pages: data.pages.map((p) => ({ ...p, items: [], archived: 0, nextCursor: null })) },
      ),
    onSettled: refresh,
  });
  const archiveRead = useMutation({ mutationFn: () => api.post("/api/feed/archive-read"), onSettled: refresh });
  const readAll = useMutation({ mutationFn: () => api.post("/api/feed/read-all"), onSettled: refresh });
  const acknowledge = useMutation({
    mutationFn: (receipt: string) => api.post(`/api/receipts/${encodeURIComponent(receipt)}/ack`),
    onSuccess: (_d, receipt) => FlarePush.dismissAlert(receipt),
    onSettled: refresh,
  });
  return { markRead, markUnread, archive, restore, deleteForever, emptyArchive, archiveRead, readAll, acknowledge, refresh };
}

/** Refreshes the feed whenever a push arrives while the app is open. */
export function useLiveFeed() {
  const qc = useQueryClient();
  useEventListener(FlarePush, "onMessage", () => {
    void qc.invalidateQueries({ queryKey: ["feed"] });
  });
}

/**
 * Registers this phone for pushes once the account is approved, and again whenever Google
 * rotates the token. The result is shown in Settings.
 */
export function usePushRegistration(enabled: boolean) {
  const api = useApi();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["registration"],
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      await requestNotificationPermission();
      const name = FlarePush.getSession().deviceName ?? defaultDeviceName();
      return registerDevice(api, name);
    },
  });
  useEventListener(FlarePush, "onToken", () => {
    void qc.invalidateQueries({ queryKey: ["registration"] });
  });
  return query;
}

/** Re-checks Android notification settings when the user comes back from the Settings app. */
export function usePushStatus() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["push-status"], queryFn: () => FlarePush.getStatus() });
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void qc.invalidateQueries({ queryKey: ["push-status"] });
    });
    return () => sub.remove();
  }, [qc]);
  return query;
}
