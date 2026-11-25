import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, ArchiveRestore, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import type { FeedItem } from "@shared/types";
import { Confirm } from "@/components/confirm";
import { PageHeader } from "@/components/page";
import { PriorityIcon } from "@/components/priority";
import { SwipeRow } from "@/components/swipe-row";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { api, errorMessage } from "@/lib/api";
import { dateTime, timeAgo } from "@/lib/format";
import { dropFromFeeds, MessageBody } from "@/pages/feed";

export function ArchivePage() {
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<FeedItem | null>(null);

  const archive = useInfiniteQuery({
    queryKey: ["feed", "archived"],
    queryFn: ({ pageParam }) => api.feed({ cursor: pageParam, archived: true }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = archive.data?.pages.flatMap((p) => p.items) ?? [];
  const total = archive.data?.pages[0]?.archived ?? 0;

  const refresh = () => qc.invalidateQueries({ queryKey: ["feed"] });
  const restore = useMutation({
    mutationFn: (item: FeedItem) => api.restoreItem(item.id),
    onMutate: (item) => dropFromFeeds(qc, item.id),
    onSuccess: () => toast.success("Moved back to the feed"),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (item: FeedItem) => api.deleteForever(item.id),
    onMutate: (item) => dropFromFeeds(qc, item.id),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: refresh,
  });
  const empty = useMutation({
    mutationFn: api.emptyArchive,
    onSuccess: () => toast.success("Archive emptied"),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: refresh,
  });

  return (
    <>
      <PageHeader
        title="Archive"
        description={total ? `${total} archived ${total === 1 ? "message" : "messages"}` : "Messages you archive land here"}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/">
                <ArrowLeft /> Feed
              </Link>
            </Button>
            <Confirm
              title="Empty the archive?"
              description="Every archived message is deleted for good. This can't be undone."
              confirmLabel="Delete all"
              onConfirm={() => empty.mutateAsync()}
            >
              <Button variant="outline" size="sm" disabled={!total || empty.isPending}>
                <Trash2 /> Empty archive
              </Button>
            </Confirm>
          </>
        }
      />

      {archive.isPending ? (
        <ul className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="space-y-2 rounded-xl border p-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-full" />
            </li>
          ))}
        </ul>
      ) : archive.isError ? (
        <p className="text-sm text-destructive">{errorMessage(archive.error)}</p>
      ) : items.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Archive />
            </EmptyMedia>
            <EmptyTitle>Nothing archived</EmptyTitle>
            <EmptyDescription>Swipe a message to the left in the feed, or use its Archive action, to file it here.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button asChild variant="outline" size="sm">
              <Link to="/">Back to the feed</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((item) => (
              <ArchiveRow
                key={item.id}
                item={item}
                onRestore={() => restore.mutate(item)}
                onDelete={() => setDeleting(item)}
              />
            ))}
          </ul>
          {archive.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={() => archive.fetchNextPage()} disabled={archive.isFetchingNextPage}>
                {archive.isFetchingNextPage ? "Loading…" : "Load older messages"}
              </Button>
            </div>
          )}
        </>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message for good?</AlertDialogTitle>
            <AlertDialogDescription>
              It's removed from your archive and can't be brought back. Other recipients keep their copy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleting) remove.mutate(deleting);
                setDeleting(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ArchiveRow({ item, onRestore, onDelete }: { item: FeedItem; onRestore: () => void; onDelete: () => void }) {
  const meta = [item.appName, item.groupName ? `via ${item.groupName}` : null].filter(Boolean).join(" · ");
  return (
    <li>
      <SwipeRow
        left={{
          label: "Restore",
          icon: <ArchiveRestore className="size-4" />,
          className: "bg-sky-600",
          onSwipe: onRestore,
          removes: true,
        }}
        right={{ label: "Delete", icon: <Trash2 className="size-4" />, className: "bg-destructive", onSwipe: onDelete }}
      >
        <div className="flex gap-3 rounded-xl border bg-background p-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {item.priority !== 0 && <PriorityIcon priority={item.priority} className="shrink-0" />}
                  <h3 className="truncate text-sm font-medium">{item.title || item.appName || "Message"}</h3>
                </div>
                {meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
              </div>
              <time className="shrink-0 pt-0.5 text-xs text-muted-foreground" title={dateTime(item.createdAt)}>
                {timeAgo(item.createdAt)}
              </time>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label="Message actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={onRestore}>
                    <ArchiveRestore /> Move to feed
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    <Trash2 /> Delete for good
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="line-clamp-4 text-muted-foreground">
              <MessageBody item={item} />
            </div>
            {item.archivedAt && (
              <p className="text-xs text-muted-foreground" title={dateTime(item.archivedAt)}>
                Archived {timeAgo(item.archivedAt)}
              </p>
            )}
          </div>
        </div>
      </SwipeRow>
    </li>
  );
}
