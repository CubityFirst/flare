import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Stack, useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import type { FeedItem } from "../../../shared/types";
import { FeedRow, FeedSeparator } from "../components/feed-row";
import { useSnackbar } from "../components/snackbar";
import { DELETE_RED, SwipeRow } from "../components/swipe-row";
import { Button, Centered } from "../components/ui";
import { useArchive, useFeedActions } from "../lib/queries";
import { useColors } from "../lib/theme";

export default function ArchiveScreen() {
  const c = useColors();
  const router = useRouter();
  const archive = useArchive();
  const snack = useSnackbar();
  const { restore, deleteForever, emptyArchive } = useFeedActions();
  const items = useMemo(() => archive.data?.pages.flatMap((p) => p.items) ?? [], [archive.data]);
  const total = archive.data?.pages[0]?.archived ?? 0;

  function confirmDelete(item: FeedItem) {
    Alert.alert("Delete this message for good?", "It's removed from your archive and can't be brought back.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteForever.mutate(item.id, { onError: (e) => snack(`Couldn't delete: ${e.message}`) }),
      },
    ]);
  }

  const header = (
    <Stack.Screen
      options={{
        title: total ? `Archive (${total})` : "Archive",
        headerRight: () =>
          total > 0 ? (
            <Pressable
              accessibilityLabel="Empty archive"
              hitSlop={12}
              style={{ padding: 4 }}
              onPress={() =>
                Alert.alert("Empty the archive?", "Every archived message is deleted for good.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete all",
                    style: "destructive",
                    onPress: () =>
                      emptyArchive.mutate(undefined, {
                        onSuccess: () => snack("Archive emptied"),
                        onError: (e) => snack(`Couldn't empty the archive: ${e.message}`),
                      }),
                  },
                ])
              }
            >
              <MaterialCommunityIcons name="delete-sweep-outline" size={24} color={c.text} />
            </Pressable>
          ) : null,
      }}
    />
  );

  if (archive.isPending) {
    return (
      <Centered>
        {header}
        <ActivityIndicator color={c.accent} />
      </Centered>
    );
  }
  if (archive.error) {
    return (
      <Centered>
        {header}
        <Text style={[styles.emptyTitle, { color: c.text }]}>Can't load the archive</Text>
        <Text style={[styles.emptyText, { color: c.muted }]}>{archive.error.message}</Text>
        <Button title="Try again" variant="secondary" onPress={() => archive.refetch()} />
      </Centered>
    );
  }

  return (
    <>
      {header}
      <Animated.FlatList
        data={items}
        keyExtractor={(i) => i.id}
        itemLayoutAnimation={LinearTransition.duration(200)}
        renderItem={({ item }) => (
          <SwipeRow
            left={{
              label: "Restore",
              icon: "archive-arrow-up-outline",
              color: c.accent,
              removes: true,
              onSwipe: () => {
                restore.mutate(item.id, { onError: (e) => snack(`Couldn't restore: ${e.message}`) });
                snack("Moved back to the feed");
              },
            }}
            right={{ label: "Delete", icon: "delete-forever-outline", color: DELETE_RED, onSwipe: () => confirmDelete(item) }}
          >
            <FeedRow item={item} onPress={() => router.push(`/item/${item.id}`)} />
          </SwipeRow>
        )}
        ItemSeparatorComponent={FeedSeparator}
        refreshControl={
          <RefreshControl
            refreshing={archive.isRefetching && !archive.isFetchingNextPage}
            onRefresh={() => void archive.refetch()}
            colors={[c.accent]}
          />
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (archive.hasNextPage && !archive.isFetchingNextPage) void archive.fetchNextPage();
        }}
        ListHeaderComponent={
          items.length > 0 ? (
            <Text style={[styles.hint, { color: c.muted }]}>Swipe right to restore, left to delete for good.</Text>
          ) : undefined
        }
        ListFooterComponent={archive.isFetchingNextPage ? <ActivityIndicator style={{ margin: 16 }} color={c.accent} /> : undefined}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="archive-outline" size={48} color={c.muted} />
            <Text style={[styles.emptyTitle, { color: c.text }]}>Nothing archived</Text>
            <Text style={[styles.emptyText, { color: c.muted }]}>Swipe a message to the left in the feed to file it here.</Text>
          </View>
        }
        contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : { paddingBottom: 32 }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, paddingHorizontal: 16, paddingVertical: 10 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "600", textAlign: "center" },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: "center", maxWidth: 320 },
});
