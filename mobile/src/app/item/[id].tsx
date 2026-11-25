import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Receipt } from "../../../../shared/types";
import { useSnackbar } from "../../components/snackbar";
import { Button, Centered, PriorityBadge } from "../../components/ui";
import { fullTime, plainText } from "../../lib/format";
import { useFeedActions, useFeedItem } from "../../lib/queries";
import { useColors } from "../../lib/theme";

export default function Item() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const router = useRouter();
  const item = useFeedItem(id);
  const snack = useSnackbar();
  const { markRead, markUnread, archive, restore, deleteForever, acknowledge } = useFeedActions();
  const data = item.data;

  // Opening a message reads it, as in the web app.
  useEffect(() => {
    if (data && data.readAt === null) markRead.mutate(data.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  if (!data) {
    return (
      <Centered>
        {item.isPending ? (
          <ActivityIndicator color={c.accent} />
        ) : (
          <>
            <Text style={[styles.title, { color: c.text }]}>Message not found</Text>
            <Text style={{ color: c.muted }}>It may have expired or been deleted for good.</Text>
          </>
        )}
      </Centered>
    );
  }

  const receipt = data.receipt;
  const pendingAck = receipt && !receipt.acknowledged && !receipt.expired && !receipt.cancelled;
  const from = [data.appName, data.senderName && `sent by ${data.senderName}`, data.groupName && `to ${data.groupName}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            data.archivedAt !== null ? (
              <View style={{ flexDirection: "row", gap: 20 }}>
                <Pressable
                  accessibilityLabel="Move back to the feed"
                  hitSlop={10}
                  onPress={() => {
                    restore.mutate(data.id, { onError: (e) => snack(`Couldn't restore: ${e.message}`) });
                    snack("Moved back to the feed");
                    router.back();
                  }}
                >
                  <MaterialCommunityIcons name="archive-arrow-up-outline" size={22} color={c.text} />
                </Pressable>
                <Pressable
                  accessibilityLabel="Delete for good"
                  hitSlop={10}
                  onPress={() =>
                    Alert.alert("Delete this message for good?", "It's removed from your archive and can't be brought back.", [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => {
                          deleteForever.mutate(data.id, { onError: (e) => snack(`Couldn't delete: ${e.message}`) });
                          router.back();
                        },
                      },
                    ])
                  }
                >
                  <MaterialCommunityIcons name="delete-forever-outline" size={22} color={c.text} />
                </Pressable>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 20 }}>
                <Pressable
                  accessibilityLabel="Mark unread"
                  hitSlop={10}
                  onPress={() => {
                    markUnread.mutate(data.id);
                    router.back();
                  }}
                >
                  <MaterialCommunityIcons name="email-mark-as-unread" size={22} color={c.text} />
                </Pressable>
                {/* An urgent alert that is still repeating has to be acknowledged, not filed away. */}
                {pendingAck ? null : (
                  <Pressable
                    accessibilityLabel="Archive"
                    hitSlop={10}
                    onPress={() => {
                      const id = data.id;
                      archive.mutate(id, { onError: (e) => snack(`Couldn't archive: ${e.message}`) });
                      snack("Archived", { label: "Undo", onPress: () => restore.mutate(id) });
                      router.back();
                    }}
                  >
                    <MaterialCommunityIcons name="archive-arrow-down-outline" size={22} color={c.text} />
                  </Pressable>
                )}
              </View>
            ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.meta}>
          <PriorityBadge priority={data.priority} />
          <Text style={{ color: c.muted, fontSize: 13 }}>{fullTime(data.createdAt)}</Text>
        </View>
        {from ? <Text style={{ color: c.muted, fontSize: 14 }}>{from}</Text> : null}
        {data.title ? <Text style={[styles.title, { color: c.text }]}>{data.title}</Text> : null}
        <Text selectable style={[styles.body, { color: c.text }]}>
          {plainText(data.body, data.html)}
        </Text>

        {data.url ? (
          <Button
            title={data.urlTitle || "Open link"}
            variant="secondary"
            icon={<MaterialCommunityIcons name="open-in-new" size={18} color={c.text} />}
            onPress={() => void Linking.openURL(data.url!)}
          />
        ) : null}

        {receipt ? (
          <View style={[styles.receipt, { borderColor: pendingAck ? c.danger : c.border, backgroundColor: pendingAck ? c.dangerSoft : c.surface }]}>
            <Text style={{ color: pendingAck ? c.danger : c.text, fontWeight: "600", fontSize: 15 }}>
              {receiptSummary(receipt)}
            </Text>
            {pendingAck ? (
              <>
                <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>
                  This alert keeps repeating until someone acknowledges it.
                </Text>
                <Button
                  title="Acknowledge"
                  variant="danger"
                  loading={acknowledge.isPending}
                  onPress={() =>
                    acknowledge.mutate(receipt.id, {
                      onError: (e) => Alert.alert("Couldn't acknowledge", e.message),
                    })
                  }
                />
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

function receiptSummary(r: Receipt): string {
  if (r.acknowledged) {
    const who = r.acknowledgedBy ? ` by ${r.acknowledgedBy}` : "";
    return `Acknowledged${who}${r.acknowledgedAt ? `, ${fullTime(r.acknowledgedAt)}` : ""}`;
  }
  if (r.cancelled) return "Cancelled by the sender";
  if (r.expired) return `Expired after ${r.sentCount} ${r.sentCount === 1 ? "alert" : "alerts"}`;
  return `Urgent: sent ${r.sentCount} ${r.sentCount === 1 ? "time" : "times"} so far`;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14 },
  meta: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 22, fontWeight: "700", lineHeight: 28 },
  body: { fontSize: 16, lineHeight: 24 },
  receipt: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 10, marginTop: 8 },
});
