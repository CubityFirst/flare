import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Link, Stack, useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { FeedItem } from "../../../shared/types";
import { Button, Centered, PriorityBadge } from "../components/ui";
import { ApiError } from "../lib/api";
import { plainText, shortTime } from "../lib/format";
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
  const { readAll } = useFeedActions();
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const unread = feed.data?.pages[0]?.unread ?? 0;

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
    <FlatList
      data={items}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <FeedRow item={item} onPress={() => router.push(`/item/${item.id}`)} />}
      ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: c.border }]} />}
      refreshControl={
        <RefreshControl refreshing={feed.isRefetching && !feed.isFetchingNextPage} onRefresh={() => void feed.refetch()} colors={[c.accent]} />
      }
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
      }}
      ListHeaderComponent={
        unread > 0 ? (
          <View style={styles.listHeader}>
            <Text style={{ color: c.muted, fontSize: 14 }}>{unread} unread</Text>
            <Pressable onPress={() => readAll.mutate()} hitSlop={8}>
              <Text style={{ color: c.accent, fontSize: 14, fontWeight: "600" }}>Mark all read</Text>
            </Pressable>
          </View>
        ) : undefined
      }
      ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator style={{ margin: 16 }} color={c.accent} /> : undefined}
      ListEmptyComponent={
        <View style={styles.empty}>
          <MaterialCommunityIcons name="bell-outline" size={48} color={c.muted} />
          <Text style={[styles.emptyTitle, { color: c.text }]}>No messages yet</Text>
          <Text style={[styles.emptyText, { color: c.muted }]}>
            Messages sent to you show up here. Send yourself a test from Settings.
          </Text>
        </View>
      }
      contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : { paddingBottom: 24 }}
    />
  );
}

function FeedRow({ item, onPress }: { item: FeedItem; onPress: () => void }) {
  const c = useColors();
  const unread = item.readAt === null;
  const pendingAck = item.receipt && !item.receipt.acknowledged && !item.receipt.expired && !item.receipt.cancelled;
  const source = [item.appName ?? item.senderName, item.groupName && `to ${item.groupName}`].filter(Boolean).join(" · ");
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: "rgba(127,127,127,0.15)" }}
      style={[styles.row, pendingAck && { backgroundColor: c.dangerSoft }]}
    >
      <View style={[styles.dot, { backgroundColor: unread ? c.accent : "transparent" }]} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.source, { color: c.muted }]}>
            {source || "Flare"}
          </Text>
          <Text style={[styles.time, { color: c.muted }]}>{shortTime(item.createdAt)}</Text>
        </View>
        {item.title ? (
          <Text numberOfLines={1} style={[styles.title, { color: c.text, fontWeight: unread ? "700" : "500" }]}>
            {item.title}
          </Text>
        ) : null}
        <Text numberOfLines={3} style={[styles.body, { color: item.title ? c.muted : c.text }]}>
          {plainText(item.body, item.html)}
        </Text>
        {item.priority !== 0 || pendingAck ? (
          <View style={styles.badges}>
            <PriorityBadge priority={item.priority} />
            {pendingAck ? <Text style={{ color: c.danger, fontSize: 12, fontWeight: "600" }}>Needs acknowledging</Text> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  listHeader: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  row: { flexDirection: "row", paddingVertical: 14, paddingRight: 16, paddingLeft: 8, gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  source: { fontSize: 13, flex: 1 },
  time: { fontSize: 13 },
  title: { fontSize: 16 },
  body: { fontSize: 15, lineHeight: 21 },
  badges: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 24 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "600", textAlign: "center" },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: "center", maxWidth: 320 },
});
