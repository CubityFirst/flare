import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import type { Priority } from "../../../shared/types";
import { PRIORITY_LABEL } from "../lib/format";
import { type Colors, useColors } from "../lib/theme";

type Variant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  style,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  icon?: ReactNode;
}) {
  const c = useColors();
  const palette: Record<Variant, { bg: string; fg: string; border: string }> = {
    primary: { bg: c.accent, fg: c.accentText, border: c.accent },
    secondary: { bg: c.surface, fg: c.text, border: c.border },
    danger: { bg: c.danger, fg: "#fff", border: c.danger },
    ghost: { bg: "transparent", fg: c.accent, border: "transparent" },
  };
  const p = palette[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      android_ripple={{ color: "rgba(127,127,127,0.2)" }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: p.bg, borderColor: p.border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={p.fg} /> : icon}
      <Text style={[styles.buttonText, { color: p.fg }]}>{title}</Text>
    </Pressable>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const c = useColors();
  const label = PRIORITY_LABEL[priority];
  if (!label) return null;
  const tone =
    priority === 2
      ? { bg: c.dangerSoft, fg: c.danger }
      : priority === 1
        ? { bg: c.warnSoft, fg: c.warn }
        : { bg: c.surface, fg: c.muted };
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.badgeText, { color: tone.fg }]}>{label}</Text>
    </View>
  );
}

export function Section({ title, children, footer }: { title?: string; children: ReactNode; footer?: string }) {
  const c = useColors();
  return (
    <View style={styles.section}>
      {title ? <Text style={[styles.sectionTitle, { color: c.muted }]}>{title}</Text> : null}
      <View style={[styles.sectionBody, { backgroundColor: c.surface, borderColor: c.border }]}>{children}</View>
      {footer ? <Text style={[styles.sectionFooter, { color: c.muted }]}>{footer}</Text> : null}
    </View>
  );
}

export function Row({
  label,
  detail,
  value,
  onPress,
  right,
  last,
  tone,
}: {
  label: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  last?: boolean;
  tone?: keyof Pick<Colors, "ok" | "warn" | "danger" | "muted">;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      android_ripple={onPress ? { color: "rgba(127,127,127,0.15)" } : undefined}
      style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.rowLabel, { color: c.text }]}>{label}</Text>
        {detail ? <Text style={[styles.rowDetail, { color: c.muted }]}>{detail}</Text> : null}
      </View>
      {value ? <Text style={[styles.rowValue, { color: tone ? c[tone] : c.muted }]}>{value}</Text> : null}
      {right}
    </Pressable>
  );
}

export function Centered({ children }: { children: ReactNode }) {
  const c = useColors();
  return <View style={[styles.centered, { backgroundColor: c.bg }]}>{children}</View>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    overflow: "hidden",
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: "600" },
  section: { marginTop: 24, paddingHorizontal: 16 },
  sectionTitle: { fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginLeft: 4 },
  sectionBody: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  sectionFooter: { fontSize: 13, marginTop: 8, marginHorizontal: 4, lineHeight: 18 },
  row: { minHeight: 56, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  rowLabel: { fontSize: 16 },
  rowDetail: { fontSize: 13, lineHeight: 18 },
  rowValue: { fontSize: 15 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 },
});
