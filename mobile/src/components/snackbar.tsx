import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface Snack {
  key: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

type Show = (message: string, action?: { label: string; onPress: () => void }) => void;

const SnackbarContext = createContext<Show>(() => {});

/** Shows one short message at a time along the bottom edge, with an optional action such as Undo. */
export function useSnackbar() {
  return useContext(SnackbarContext);
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snack, setSnack] = useState<Snack | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const insets = useSafeAreaInsets();

  const show = useCallback<Show>((message, action) => {
    clearTimeout(timer.current);
    setSnack({ key: Date.now(), message, actionLabel: action?.label, onAction: action?.onPress });
    timer.current = setTimeout(() => setSnack(null), 5000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <SnackbarContext.Provider value={show}>
      <View style={{ flex: 1 }}>
        {children}
        {snack ? (
          <Animated.View
            key={snack.key}
            entering={FadeInDown.duration(180)}
            exiting={FadeOutDown.duration(150)}
            style={[styles.snack, { bottom: insets.bottom + 16 }]}
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.message} numberOfLines={2}>
              {snack.message}
            </Text>
            {snack.actionLabel ? (
              <Pressable
                hitSlop={12}
                accessibilityRole="button"
                onPress={() => {
                  clearTimeout(timer.current);
                  setSnack(null);
                  snack.onAction?.();
                }}
              >
                <Text style={styles.action}>{snack.actionLabel}</Text>
              </Pressable>
            ) : null}
          </Animated.View>
        ) : null}
      </View>
    </SnackbarContext.Provider>
  );
}

const styles = StyleSheet.create({
  // Inverse surface, as Material snackbars are: dark in light mode, light text on it either way.
  snack: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#2b2930",
    elevation: 6,
  },
  message: { flex: 1, color: "#f4f3f6", fontSize: 15 },
  action: { color: "#f0abfc", fontSize: 15, fontWeight: "700" },
});
