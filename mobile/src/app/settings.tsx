import { useMutation, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useState } from "react";
import { Alert, ScrollView, Switch, Text, View } from "react-native";
import type { SendMessageResponse } from "../../../shared/types";
import FlarePush from "../../modules/flare-push";
import { Button, Row, Section } from "../components/ui";
import { useMe, usePushRegistration, usePushStatus } from "../lib/queries";
import { requestNotificationPermission } from "../lib/push";
import { useApi, useSession } from "../lib/session";
import { useColors } from "../lib/theme";

export default function Settings() {
  const c = useColors();
  const api = useApi();
  const qc = useQueryClient();
  const { signOut, baseUrl } = useSession();
  const me = useMe();
  const registration = usePushRegistration(me.data?.user.status === "active");
  const status = usePushStatus();
  const s = status.data;
  const [previewing, setPreviewing] = useState(false);

  const sendTest = useMutation({
    mutationFn: (priority: 0 | 2) =>
      api.post<SendMessageResponse>("/api/messages", {
        to: "me",
        priority,
        title: priority === 2 ? "Urgent test" : "Test notification",
        message:
          priority === 2
            ? "This is what an urgent alert sounds like. Acknowledge it to stop the repeats."
            : "Notifications from Flare are working on this phone.",
        ...(priority === 2 && { retry: 60, expire: 300 }),
      }),
    onSuccess: (r) =>
      r.recipients === 0 ? Alert.alert("Not sent", "Flare couldn't find you as a recipient.") : undefined,
    onError: (e) => Alert.alert("Couldn't send", e.message),
  });

  const reg = registration.data;
  const pushRow = (() => {
    if (registration.isPending) return { value: "Checking…", tone: "muted" as const, detail: undefined };
    if (!reg) return { value: "Unknown", tone: "muted" as const, detail: registration.error?.message };
    switch (reg.state) {
      case "registered":
        return { value: "On", tone: "ok" as const, detail: `Registered as "${reg.device.name}"` };
      case "no-firebase":
        return {
          value: "Unavailable",
          tone: "warn" as const,
          detail: "This build has no Firebase config (google-services.json), so it can't receive pushes.",
        };
      case "error":
        return { value: "Failed", tone: "danger" as const, detail: reg.message };
    }
  })();

  const refreshStatus = () => void qc.invalidateQueries({ queryKey: ["push-status"] });

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <Section title="Account">
        <Row label={me.data?.user.name ?? "Signed in"} detail={me.data?.user.email ?? undefined} />
        <Row
          label="Sign out"
          last
          onPress={() =>
            Alert.alert("Sign out?", "This phone stops getting your alerts until you sign in again.", [
              { text: "Cancel", style: "cancel" },
              { text: "Sign out", style: "destructive", onPress: () => void signOut() },
            ])
          }
        />
      </Section>

      <Section
        title="This phone"
        footer="Manage your apps, API keys and groups in Flare on the web."
      >
        <Row label="Push notifications" value={pushRow.value} tone={pushRow.tone} detail={pushRow.detail} />
        {s && !s.notificationsEnabled ? (
          <Row
            label="Allow notifications"
            detail="Android is blocking Flare's notifications."
            tone="danger"
            value="Off"
            onPress={async () => {
              const granted = await requestNotificationPermission();
              if (!granted) FlarePush.openSettings("notifications");
              refreshStatus();
              void qc.invalidateQueries({ queryKey: ["registration"] });
            }}
          />
        ) : null}
        <Row label="Notification settings" detail="Sounds and pop-ups per priority" onPress={() => FlarePush.openSettings("notifications")} last />
      </Section>

      <Section
        title="Urgent alerts"
        footer="Urgent alerts play at alarm volume, so they ring even when the phone is on silent or vibrate."
      >
        <Row
          label="Play at full volume"
          detail="Turns the alarm volume up while an urgent alert plays, then puts it back"
          right={
            <Switch
              value={s?.overrideVolume ?? true}
              onValueChange={(v) => {
                FlarePush.setOverrideVolume(v);
                refreshStatus();
              }}
              trackColor={{ true: c.accent }}
              thumbColor="#fff"
            />
          }
        />
        <Row
          label="Break through Do Not Disturb"
          detail={s?.dndAccess ? "Allowed" : "Needs Do Not Disturb access for Flare"}
          value={s?.dndAccess ? "On" : "Off"}
          tone={s?.dndAccess ? "ok" : "warn"}
          onPress={() => FlarePush.openSettings("dnd")}
        />
        <Row
          label="Full-screen alerts"
          detail="Shows urgent alerts over the lock screen, like an alarm clock"
          value={s?.fullScreenAllowed ? "On" : "Off"}
          tone={s?.fullScreenAllowed ? "ok" : "warn"}
          onPress={() => FlarePush.openSettings("fullScreen")}
        />
        <Row
          label={previewing ? "Stop sound" : "Preview urgent sound"}
          detail="Plays the klaxon at alarm volume"
          last
          onPress={() => {
            if (previewing) {
              FlarePush.stopSound();
              setPreviewing(false);
            } else {
              void FlarePush.previewSound("klaxon", true);
              setPreviewing(true);
              setTimeout(() => setPreviewing(false), 15_000);
            }
          }}
        />
      </Section>

      <Section title="Test" footer="Sends a real message through Flare to all your devices.">
        <View style={{ padding: 16, gap: 12 }}>
          <Button
            title="Send a test notification"
            variant="secondary"
            loading={sendTest.isPending && sendTest.variables === 0}
            onPress={() => sendTest.mutate(0)}
          />
          <Button
            title="Send an urgent test"
            variant="secondary"
            loading={sendTest.isPending && sendTest.variables === 2}
            onPress={() => sendTest.mutate(2)}
          />
        </View>
      </Section>

      {__DEV__ ? (
        <Section title="Debug" footer="Shows a notification on this phone only, through the same code a push uses.">
          {([-1, 0, 1, 2] as const).map((priority, i, all) => (
            <Row
              key={priority}
              label={`Local ${["quiet", "normal", "high", "urgent"][i]} notification`}
              last={i === all.length - 1}
              onPress={() =>
                void FlarePush.showLocal(
                  JSON.stringify({
                    v: 1,
                    type: "message",
                    deliveryId: `local-${Date.now()}`,
                    messageId: `local-${Date.now()}`,
                    title: priority === 2 ? "Database down" : "Local test",
                    body: priority === 2 ? "Primary Postgres on db-01 is not answering health checks." : `Priority ${priority}`,
                    priority,
                    sound: null,
                    soundUrl: null,
                    url: priority === 0 ? "https://flare.cubityfir.st" : null,
                    receipt: priority === 2 ? "local-receipt" : null,
                    attempt: 1,
                    ts: Date.now(),
                  }),
                )
              }
            />
          ))}
        </Section>
      ) : null}

      <Text style={{ color: c.muted, fontSize: 12, textAlign: "center", marginTop: 24 }}>
        Flare {Constants.expoConfig?.version} · {baseUrl.replace(/^https?:\/\//, "")}
      </Text>
    </ScrollView>
  );
}
