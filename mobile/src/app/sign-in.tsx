import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlareMark } from "../components/flare-mark";
import { Button } from "../components/ui";
import { DEFAULT_URL, useSession } from "../lib/session";
import { useColors } from "../lib/theme";

export default function SignIn() {
  const c = useColors();
  const { signIn, baseUrl } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Debug builds can sign in to a local `cf dev` server instead (e.g. http://localhost:5173
  // with `adb reverse tcp:5173 tcp:5173`).
  const [server, setServer] = useState(baseUrl);

  // React Native's URL class is partial, so compare hosts by hand.
  const host = (u: string) => /^[a-z]+:\/\/([^/?#]+)/i.exec(u.trim())?.[1]?.toLowerCase();
  const provider = host(server) === host(DEFAULT_URL) ? "cubityfir.st" : null;

  async function go(dev = false) {
    setBusy(true);
    setError(null);
    try {
      await signIn(server, { dev });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={styles.hero}>
        <FlareMark size={88} />
        <Text style={[styles.title, { color: c.text }]}>Flare</Text>
        <Text style={[styles.subtitle, { color: c.muted }]}>
          Alerts from your scripts and servers, on your phone. Urgent ones ring even when it's on silent.
        </Text>
      </View>
      <View style={styles.actions}>
        {error ? <Text style={[styles.error, { color: c.danger }]}>{error}</Text> : null}
        <Button title={provider ? `Sign in with ${provider}` : "Sign in"} onPress={() => go()} loading={busy} />
        {__DEV__ ? (
          <View style={{ gap: 6 }}>
            <Text style={[styles.devLabel, { color: c.muted }]}>Server (debug builds only)</Text>
            <TextInput
              value={server}
              onChangeText={setServer}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
            />
            {!provider ? <Button title="Dev sign-in (local cf dev)" variant="ghost" onPress={() => go(true)} /> : null}
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, justifyContent: "space-between" },
  hero: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  title: { fontSize: 32, fontWeight: "700", marginTop: 8 },
  subtitle: { fontSize: 16, lineHeight: 22, textAlign: "center", maxWidth: 300 },
  actions: { gap: 16, paddingBottom: 8 },
  error: { fontSize: 14, textAlign: "center" },
  devLabel: { fontSize: 12 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
});
