import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  Inbox,
  Mail,
  MailOpen,
  MoreHorizontal,
  Siren,
  Trash2,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import type { FeedItem } from "@shared/types";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage } from "@/lib/api";
import { dateTime, timeAgo } from "@/lib/format";
import { sanitizeHtml } from "@/lib/html";
import { playSound } from "@/lib/sounds";
import { cn } from "@/lib/utils";

function isActiveUrgent(item: FeedItem) {
  const r = item.receipt;
  return Boolean(r && !r.acknowledged && !r.expired && !r.cancelled);
}

function MessageBody({ item }: { item: FeedItem }) {
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
}: {
  item: FeedItem;
  highlighted: boolean;
  onAck: (item: FeedItem) => void;
  acking: boolean;
}) {
  const qc = useQueryClient();
  const ref = useRef<HTMLLIElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["feed"] });
  const markRead = useMutation({ mutationFn: () => api.markRead(item.id), onSuccess: refresh });
  const markUnread = useMutation({ mutationFn: () => api.markUnread(item.id), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api.deleteItem(item.id), onSuccess: refresh });
  const urgent = isActiveUrgent(item);
  const unread = !item.readAt;

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);

  const meta = [item.appName, item.groupName ? `via ${item.groupName}` : null].filter(Boolean).join(" · ");

  return (
    <li
      ref={ref}
      onClick={() => unread && !urgent && markRead.mutate()}
      className={cn(
        "relative flex gap-3 rounded-xl border bg-card p-4 transition-colors before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-full",
        priorityAccent(item.priority),
        unread ? "border-border" : "border-transparent bg-transparent",
        urgent && "border-red-500/40 bg-red-500/5",
        highlighted && "ring-2 ring-primary/50",
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
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate()}>
                <Trash2 /> Delete
              </DropdownMenuItem>
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
  const clearRead = useMutation({
    mutationFn: api.clearRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feed"] }),
  });

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
                <DropdownMenuItem variant="destructive" onSelect={() => clearRead.mutate()}>
                  <Trash2 /> Clear read messages
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
    </>
  );
}
