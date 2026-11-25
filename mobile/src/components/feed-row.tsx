import { Pressable, StyleSheet, Text, View } from "react-native";
import type { FeedItem } from "../../../shared/types";
import { plainText, shortTime } from "../lib/format";
import { useColors } from "../lib/theme";
import { PriorityBadge } from "./ui";

/** An urgent alert that is still repeating, waiting for someone to acknowledge it. */
export function isPendingUrgent(item: FeedItem) {
  const r = item.receipt;
  return Boolean(r && !r.acknowledged && !r.expired && !r.cancelled);
}

export function FeedRow({ item, onPress }: { item: FeedItem; onPress: () => void }) {
  const c = useColors();
  const unread = item.readAt === null;
  const pendingAck = isPendingUrgent(item);
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

export function FeedSeparator() {
  const c = useColors();
  return <View style={[styles.separator, { backgroundColor: c.border }]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", paddingVertical: 14, paddingRight: 16, paddingLeft: 8, gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  source: { fontSize: 13, flex: 1 },
  time: { fontSize: 13 },
  title: { fontSize: 16 },
  body: { fontSize: 15, lineHeight: 21 },
  badges: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 24 },
});
