import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Link, Stack, useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import type { FeedItem } from "../../../shared/types";
import { FeedRow, FeedSeparator, isPendingUrgent } from "../components/feed-row";
import { useSnackbar } from "../components/snackbar";
import { ARCHIVE_GREY, SwipeRow } from "../components/swipe-row";
import { Button, Centered } from "../components/ui";
import { ApiError } from "../lib/api";
import { useFeed, useFeedActions, useLiveFeed, useMe, usePushRegistration } from "../lib/queries";
import { useSession } from "../lib/session";
import { useColors } from "../lib/theme";

export default function Feed() {
  const c = useColors();
  const me = useMe();
  const active = me.data?.user.status === "active";
  usePushRegistration(active);
  useLiveFeed();

  const header = (
    <Stack.Screen
      options={{
        headerRight: () => (
          <Link href="/settings" asChild>
            <Pressable accessibilityLabel="Settings" hitSlop={12} style={{ padding: 4 }}>
              <MaterialCommunityIcons name="cog-outline" size={24} color={c.text} />
            </Pressable>
          </Link>
        ),
      }}
    />
  );

  if (me.isPending) {
    return (
      <Centered>
        {header}
        <ActivityIndicator color={c.accent} />
      </Centered>
    );
  }
  if (me.error || !me.data) {
    return (
      <Centered>
        {header}
        <Text style={[styles.emptyTitle, { color: c.text }]}>Can't load your account</Text>
        <Text style={[styles.emptyText, { color: c.muted }]}>{me.error?.message}</Text>
        <Button title="Try again" variant="secondary" onPress={() => me.refetch()} />
      </Centered>
    );
  }
  if (!active) return <NotApproved status={me.data.user.status} onRefresh={() => me.refetch()} header={header} />;
  return (
    <>
      {header}
      <FeedList />
    </>
  );
}

function NotApproved({ status, onRefresh, header }: { status: string; onRefresh: () => void; header: React.ReactNode }) {
  const c = useColors();
  const { signOut } = useSession();
  return (
    <Centered>
      {header}
      <MaterialCommunityIcons name={status === "disabled" ? "account-cancel-outline" : "account-clock-outline"} size={48} color={c.muted} />
      <Text style={[styles.emptyTitle, { color: c.text }]}>
        {status === "disabled" ? "Your account is disabled" : "Waiting for approval"}
      </Text>
      <Text style={[styles.emptyText, { color: c.muted }]}>
        {status === "disabled"
          ? "Ask a Flare admin to re-enable it."
          : "A Flare admin needs to approve your account. You'll be able to get alerts once they have."}
      </Text>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Button title="Check again" variant="secondary" onPress={onRefresh} />
        <Button title="Sign out" variant="ghost" onPress={() => void signOut()} />
      </View>
    </Centered>
  );
}

function FeedList() {
  const c = useColors();
  const router = useRouter();
  const feed = useFeed();
  const snack = useSnackbar();
  const { readAll, markRead, markUnread, archive, restore, archiveRead } = useFeedActions();
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const unread = feed.data?.pages[0]?.unread ?? 0;
  const archived = feed.data?.pages[0]?.archived ?? 0;
  const anyRead = items.some((i) => i.readAt !== null && !isPendingUrgent(i));

  function archiveItem(item: FeedItem) {
    archive.mutate(item.id, { onError: (e) => snack(`Couldn't archive: ${e.message}`) });
    snack("Archived", { label: "Undo", onPress: () => restore.mutate(item.id) });
  }

  if (feed.isPending) {
    return (
      <Centered>
        <ActivityIndicator color={c.accent} />
      </Centered>
    );
  }
  if (feed.error) {
    return (
      <Centered>
        <Text style={[styles.emptyTitle, { color: c.text }]}>Can't load messages</Text>
        <Text style={[styles.emptyText, { color: c.muted }]}>
          {feed.error instanceof ApiError ? feed.error.message : String(feed.error)}
        </Text>
        <Button title="Try again" variant="secondary" onPress={() => feed.refetch()} />
      </Centered>
    );
  }

  return (
    <Animated.FlatList
      data={items}
      keyExtractor={(i) => i.id}
      // Rows below a swiped-away message slide up into its place.
      itemLayoutAnimation={LinearTransition.duration(200)}
      renderItem={({ item }) => {
        // Urgent alerts that are still repeating stay put until they're acknowledged.
        const locked = isPendingUrgent(item);
        return (
          <SwipeRow
            left={
              locked
                ? undefined
                : item.readAt === null
                  ? { label: "Read", icon: "email-open-outline", color: c.accent, onSwipe: () => markRead.mutate(item.id) }
                  : { label: "Unread", icon: "email-outline", color: c.accent, onSwipe: () => markUnread.mutate(item.id) }
            }
            right={
              locked
                ? undefined
                : { label: "Archive", icon: "archive-arrow-down-outline", color: ARCHIVE_GREY, onSwipe: () => archiveItem(item), removes: true }
            }
          >
            <FeedRow item={item} onPress={() => router.push(`/item/${item.id}`)} />
          </SwipeRow>
        );
      }}
      ItemSeparatorComponent={FeedSeparator}
      refreshControl={
        <RefreshControl refreshing={feed.isRefetching && !feed.isFetchingNextPage} onRefresh={() => void feed.refetch()} colors={[c.accent]} />
      }
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
      }}
      ListHeaderComponent={
        unread > 0 || anyRead ? (
          <View style={styles.listHeader}>
            <Text style={{ color: c.muted, fontSize: 14, flex: 1 }}>{unread > 0 ? `${unread} unread` : ""}</Text>
            {unread > 0 ? (
              <Pressable onPress={() => readAll.mutate()} hitSlop={8}>
                <Text style={[styles.headerAction, { color: c.accent }]}>Mark all read</Text>
              </Pressable>
            ) : null}
            {anyRead ? (
              <Pressable
                onPress={() =>
                  archiveRead.mutate(undefined, {
                    onSuccess: () => snack("Read messages archived"),
                    onError: (e) => snack(`Couldn't archive: ${e.message}`),
                  })
                }
                hitSlop={8}
              >
                <Text style={[styles.headerAction, { color: c.accent }]}>Archive read</Text>
              </Pressable>
            ) : null}
          </View>
        ) : undefined
      }
      ListFooterComponent={
        feed.isFetchingNextPage ? (
          <ActivityIndicator style={{ margin: 16 }} color={c.accent} />
        ) : !feed.hasNextPage && archived > 0 ? (
          <ArchiveLink count={archived} onPress={() => router.push("/archive")} />
        ) : undefined
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <MaterialCommunityIcons name={archived > 0 ? "check-all" : "bell-outline"} size={48} color={c.muted} />
          <Text style={[styles.emptyTitle, { color: c.text }]}>{archived > 0 ? "All caught up" : "No messages yet"}</Text>
          <Text style={[styles.emptyText, { color: c.muted }]}>
            {archived > 0
              ? "New messages show up here. Older ones are in the archive."
              : "Messages sent to you show up here. Send yourself a test from Settings."}
          </Text>
        </View>
      }
      contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : { paddingBottom: 32 }}
    />
  );
}

function ArchiveLink({ count, onPress }: { count: number; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`Archive, ${count} ${count === 1 ? "message" : "messages"}`}
      android_ripple={{ color: "rgba(127,127,127,0.15)" }}
      style={[styles.archiveLink, { borderTopColor: c.border }]}
    >
      <MaterialCommunityIcons name="archive-outline" size={20} color={c.muted} />
      <Text style={{ flex: 1, color: c.text, fontSize: 15 }}>Archive</Text>
      <Text style={{ color: c.muted, fontSize: 15, fontVariant: ["tabular-nums"] }}>{count}</Text>
      <MaterialCommunityIcons name="chevron-right" size={20} color={c.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  listHeader: { flexDirection: "row", alignItems: "center", gap: 20, paddingHorizontal: 16, paddingVertical: 10 },
  headerAction: { fontSize: 14, fontWeight: "600" },
  archiveLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "600", textAlign: "center" },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: "center", maxWidth: 320 },
});
