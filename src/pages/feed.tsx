import { type InfiniteData, type QueryClient, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BellRing,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Inbox,
  Mail,
  MailOpen,
  MoreHorizontal,
  Siren,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import type { FeedItem, FeedPage as FeedPageData } from "@shared/types";
import { PageHeader } from "@/components/page";
import { PriorityIcon, priorityAccent } from "@/components/priority";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { SwipeRow } from "@/components/swipe-row";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage } from "@/lib/api";
import { dateTime, timeAgo } from "@/lib/format";
import { sanitizeHtml } from "@/lib/html";
import { playSound } from "@/lib/sounds";
import { cn } from "@/lib/utils";

export function isActiveUrgent(item: FeedItem) {
  const r = item.receipt;
  return Boolean(r && !r.acknowledged && !r.expired && !r.cancelled);
}

/** Takes an item out of every cached feed list straight away, so a swiped row doesn't flash back. */
export function dropFromFeeds(qc: QueryClient, id: string) {
  qc.setQueriesData<InfiniteData<FeedPageData>>({ queryKey: ["feed"] }, (data) =>
    data?.pages
      ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((i) => i.id !== id) })) }
      : data,
  );
}

export function MessageBody({ item }: { item: FeedItem }) {
  const html = useMemo(() => (item.html ? sanitizeHtml(item.body) : null), [item.html, item.body]);
  if (html !== null) {
    return <div className="message-html text-sm break-words whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <p className="text-sm break-words whitespace-pre-wrap">{item.body}</p>;
}

function ReceiptStatus({ item }: { item: FeedItem }) {
  const r = item.receipt!;
  if (r.acknowledged) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-emerald-600" />
        Acknowledged by {r.acknowledgedBy ?? "someone"} {r.acknowledgedAt ? timeAgo(r.acknowledgedAt) : ""}
      </p>
    );
  }
  if (r.cancelled) return <p className="text-xs text-muted-foreground">Cancelled by the sender</p>;
  if (r.expired) return <p className="text-xs text-muted-foreground">Expired without acknowledgement</p>;
  return null;
}

function FeedRow({
  item,
  highlighted,
  onAck,
  acking,
  onArchive,
}: {
  item: FeedItem;
  highlighted: boolean;
  onAck: (item: FeedItem) => void;
  acking: boolean;
  onArchive: (item: FeedItem) => void;
}) {
  const qc = useQueryClient();
  const ref = useRef<HTMLLIElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["feed"] });
  const markRead = useMutation({ mutationFn: () => api.markRead(item.id), onSuccess: refresh });
  const markUnread = useMutation({ mutationFn: () => api.markUnread(item.id), onSuccess: refresh });
  const urgent = isActiveUrgent(item);
  const unread = !item.readAt;

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);

  const meta = [item.appName, item.groupName ? `via ${item.groupName}` : null].filter(Boolean).join(" · ");

  return (
    <li ref={ref}>
      <SwipeRow
        // Urgent alerts that are still repeating stay put until they're acknowledged.
        left={
          urgent
            ? undefined
            : unread
              ? { label: "Read", icon: <MailOpen className="size-4" />, className: "bg-sky-600", onSwipe: () => markRead.mutate() }
              : { label: "Unread", icon: <Mail className="size-4" />, className: "bg-sky-600", onSwipe: () => markUnread.mutate() }
        }
        right={
          urgent
            ? undefined
            : {
                label: "Archive",
                icon: <Archive className="size-4" />,
                className: "bg-zinc-600",
                onSwipe: () => onArchive(item),
                removes: true,
              }
        }
      >
        <div
          onClick={() => unread && !urgent && markRead.mutate()}
          className={cn(
            "group relative flex gap-3 rounded-xl border bg-card p-4 transition-colors before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-full",
            priorityAccent(item.priority),
            // Read rows sit flush with the page, but stay opaque so a swipe slides them over the action strip.
            unread ? "border-border" : "border-transparent bg-background",
            urgent && "border-red-500/40 bg-red-500/5",
            highlighted && "ring-2 ring-primary/50 ring-inset",
          )}
        >
          <div className="flex w-2 shrink-0 justify-center pt-1.5">
            {unread && <span className="size-2 rounded-full bg-primary" aria-label="Unread" />}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {item.priority !== 0 && <PriorityIcon priority={item.priority} className="shrink-0" />}
                  <h3 className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
                    {item.title || item.appName || "Message"}
                  </h3>
                </div>
                {meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
              </div>
              <time className="shrink-0 pt-0.5 text-xs text-muted-foreground" title={dateTime(item.createdAt)}>
                {timeAgo(item.createdAt)}
              </time>
              {!urgent && (
                // One-click archive for mouse users; touch screens swipe instead.
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Archive"
                  title="Archive"
                  className="hidden opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:hover)]:inline-flex"
                  onClick={(e) => {
                    e.stopPropagation();
                    onArchive(item);
                  }}
                >
                  <Archive />
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label="Message actions" onClick={(e) => e.stopPropagation()}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  {unread ? (
                    <DropdownMenuItem onSelect={() => markRead.mutate()}>
                      <MailOpen /> Mark as read
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => markUnread.mutate()}>
                      <Mail /> Mark as unread
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => playSound(item.sound, item.soundUrl)}>
                    <Volume2 /> Play sound
                  </DropdownMenuItem>
                  {!urgent && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onArchive(item)}>
                        <Archive /> Archive
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <MessageBody item={item} />

            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-3.5 shrink-0" />
                <span className="truncate">{item.urlTitle || item.url}</span>
              </a>
            )}

            {item.receipt && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {urgent ? (
                  <>
                    <Button
                      size="sm"
                      className="bg-red-600 text-white hover:bg-red-700"
                      disabled={acking}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAck(item);
                      }}
                    >
                      <CheckCheck /> Acknowledge
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Repeating until acknowledged · sent {item.receipt.sentCount}×
                    </span>
                  </>
                ) : (
                  <ReceiptStatus item={item} />
                )}
              </div>
            )}
          </div>
        </div>
      </SwipeRow>
    </li>
  );
}

function FeedSkeleton() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="space-y-2 rounded-xl border p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </li>
      ))}
    </ul>
  );
}

export function FeedPage() {
  const [params, setParams] = useSearchParams();
  const filter = params.get("filter") === "unread" ? "unread" : "all";
  const highlight = params.get("item");
  const qc = useQueryClient();

  const feed = useInfiniteQuery({
    queryKey: ["feed", filter],
    queryFn: ({ pageParam }) => api.feed({ cursor: pageParam, unread: filter === "unread" }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 30_000,
  });

  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = feed.data?.pages[0]?.unread ?? 0;
  const activeUrgent = items.filter(isActiveUrgent);

  // Keep the home-screen icon badge in sync (supported by installed PWAs on iOS and Android).
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (unread > 0) void nav.setAppBadge?.(unread).catch(() => {});
    else void nav.clearAppBadge?.().catch(() => {});
  }, [unread]);

  // Opening a notification marks it read.
  useEffect(() => {
    if (!highlight) return;
    const item = items.find((i) => i.id === highlight);
    if (item && !item.readAt && !isActiveUrgent(item)) {
      void api.markRead(item.id).then(() => qc.invalidateQueries({ queryKey: ["feed"] }));
    }
  }, [highlight, items, qc]);

  const ack = useMutation({
    mutationFn: (item: FeedItem) => api.acknowledge(item.receipt!.id),
    onSuccess: () => toast.success("Acknowledged"),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["feed"] }),
  });
  const markAll = useMutation({
    mutationFn: api.markAllRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feed"] }),
  });
  const archiveRead = useMutation({
    mutationFn: api.archiveRead,
    onSuccess: () => toast.success("Read messages archived"),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["feed"] }),
  });
  // Archive and undo share a scope, so an undo waits for the archive it reverses.
  const restore = useMutation({
    scope: { id: "feed-archive" },
    mutationFn: (item: FeedItem) => api.restoreItem(item.id),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["feed"] }),
  });
  const archive = useMutation({
    scope: { id: "feed-archive" },
    mutationFn: (item: FeedItem) => api.archiveItem(item.id),
    onMutate: (item) => {
      dropFromFeeds(qc, item.id);
      toast("Archived", {
        description: item.title || item.appName || undefined,
        action: { label: "Undo", onClick: () => restore.mutate(item) },
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["feed"] }),
  });
  const archivedCount = feed.data?.pages[0]?.archived ?? 0;

  return (
    <>
      <PageHeader
        title="Feed"
        description={unread ? `${unread} unread` : "You're all caught up"}
        actions={
          <>
            <Button variant="outline" size="sm" disabled={!unread || markAll.isPending} onClick={() => markAll.mutate()}>
              <CheckCheck /> Mark all read
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="More feed actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => archiveRead.mutate()}>
                  <Archive /> Archive read messages
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/archive">
                    <Inbox /> Open archive
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {activeUrgent.length > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">
          <Siren className="size-5 shrink-0 animate-pulse text-red-600" />
          <span className="flex-1">
            {activeUrgent.length === 1
              ? "An urgent alert is waiting for acknowledgement."
              : `${activeUrgent.length} urgent alerts are waiting for acknowledgement.`}
          </span>
        </div>
      )}

      <Tabs
        value={filter}
        onValueChange={(v) => setParams(v === "unread" ? { filter: "unread" } : {}, { replace: true })}
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">
            Unread
            {unread > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
                {unread}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {feed.isPending ? (
        <FeedSkeleton />
      ) : feed.isError ? (
        <p className="text-sm text-destructive">{errorMessage(feed.error)}</p>
      ) : items.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">{filter === "unread" ? <Inbox /> : <BellRing />}</EmptyMedia>
            <EmptyTitle>{filter === "unread" ? "No unread messages" : "No messages yet"}</EmptyTitle>
            <EmptyDescription>
              {filter === "unread"
                ? "New notifications will appear here."
                : "Enable notifications on this device, then send yourself a test message."}
            </EmptyDescription>
          </EmptyHeader>
          {filter === "all" && (
            <EmptyContent className="flex-row justify-center">
              <Button asChild variant="outline" size="sm">
                <Link to="/devices">Set up this device</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/send">Send a message</Link>
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((item) => (
              <FeedRow
                key={item.id}
                item={item}
                highlighted={item.id === highlight}
                onAck={(i) => ack.mutate(i)}
                acking={ack.isPending}
                onArchive={(i) => archive.mutate(i)}
              />
            ))}
          </ul>
          {feed.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
                {feed.isFetchingNextPage ? "Loading…" : "Load older messages"}
              </Button>
            </div>
          )}
        </>
      )}

      {!feed.isPending && !feed.hasNextPage && archivedCount > 0 && <ArchiveLink count={archivedCount} />}
    </>
  );
}

function ArchiveLink({ count }: { count: number }) {
  return (
    <Link
      to="/archive"
      className="mt-6 flex items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
    >
      <Archive className="size-4 shrink-0" />
      <span className="flex-1">Archive</span>
      <span className="tabular-nums">{count}</span>
      <ChevronRight className="size-4 shrink-0" />
    </Link>
  );
}
