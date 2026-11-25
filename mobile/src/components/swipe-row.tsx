import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { type ReactNode, useRef } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Swipeable, { type SwipeableMethods, SwipeDirection } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { interpolate, type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { useColors } from "../lib/theme";

export interface SwipeAction {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
  onSwipe: () => void;
  /**
   * For actions that take the row out of the list: the whole row slides off screen. Others
   * reveal a short strip and spring back once the action has run.
   */
  removes?: boolean;
}

const STRIP = 96;

/** Strip colours that keep white text readable in light and dark mode. */
export const ARCHIVE_GREY = "#5b5763";
export const DELETE_RED = "#dc2626";

/**
 * A feed row that can be swiped sideways. Swiping right runs `left` (revealed on the left),
 * swiping left runs `right`. Leave an action out to block that direction.
 */
export function SwipeRow({ left, right, children }: { left?: SwipeAction; right?: SwipeAction; children: ReactNode }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const ref = useRef<SwipeableMethods>(null);
  const reach = (a?: SwipeAction) => (a?.removes ? width : STRIP);
  const threshold = (a?: SwipeAction) => (a?.removes ? width * 0.35 : STRIP * 0.6);

  return (
    <Swipeable
      ref={ref}
      friction={1}
      overshootFriction={8}
      leftThreshold={threshold(left)}
      rightThreshold={threshold(right)}
      overshootLeft={!left?.removes}
      overshootRight={!right?.removes}
      childrenContainerStyle={{ backgroundColor: c.bg }}
      renderLeftActions={
        left ? (progress) => <ActionStrip action={left} width={reach(left)} progress={progress} side="left" /> : undefined
      }
      renderRightActions={
        right ? (progress) => <ActionStrip action={right} width={reach(right)} progress={progress} side="right" /> : undefined
      }
      onSwipeableOpen={(direction) => {
        // RIGHT means the row moved right, uncovering the left action.
        const action = direction === SwipeDirection.RIGHT ? left : right;
        if (!action) return;
        action.onSwipe();
        if (action.removes) {
          // The row normally unmounts here. If it's still around (the request failed), bring it back.
          setTimeout(() => ref.current?.close(), 800);
        } else {
          ref.current?.close();
        }
      }}
    >
      {children}
    </Swipeable>
  );
}

function ActionStrip({
  action,
  width,
  progress,
  side,
}: {
  action: SwipeAction;
  width: number;
  progress: SharedValue<number>;
  side: "left" | "right";
}) {
  // The icon grows to full size as the swipe reaches the point where letting go runs the action.
  const armedAt = action.removes ? 0.35 : 0.6;
  const iconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, armedAt * 0.5, armedAt], [0, 0.6, 1], "clamp"),
    transform: [{ scale: interpolate(progress.value, [0, armedAt], [0.7, 1], "clamp") }],
  }));
  return (
    <View
      style={[
        styles.strip,
        { width, backgroundColor: action.color, justifyContent: side === "left" ? "flex-start" : "flex-end" },
      ]}
    >
      <Animated.View style={[styles.label, iconStyle]}>
        <MaterialCommunityIcons name={action.icon} size={22} color="#fff" />
        <Text style={styles.text}>{action.label}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 24 },
  label: { flexDirection: "row", alignItems: "center", gap: 8 },
  text: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
