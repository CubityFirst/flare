import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing, Laptop, MoreHorizontal, Pencil, Share, Smartphone, SquarePlus, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Device } from "@shared/types";
import { Confirm } from "@/components/confirm";
import { PageHeader } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useMe } from "@/hooks/use-me";
import { api, errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { currentSubscription, defaultDeviceName, disablePushOnThisDevice, enablePush, pushSupport } from "@/lib/push";

function useThisDeviceEndpoint() {
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const refresh = () => void currentSubscription().then((s) => setEndpoint(s?.endpoint ?? null));
  useEffect(refresh, []);
  return { endpoint, refresh };
}

function InstallInstructions() {
  return (
    <Alert>
      <Smartphone />
      <AlertTitle>Add Flare to your Home Screen first</AlertTitle>
      <AlertDescription>
        <p>On iPhone and iPad, web notifications only work once Flare is installed as an app (iOS 16.4 or later):</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Tap <Share className="inline size-4 align-text-bottom" /> <strong>Share</strong> in Safari.
          </li>
          <li>
            Choose <SquarePlus className="inline size-4 align-text-bottom" /> <strong>Add to Home Screen</strong>.
          </li>
          <li>Open Flare from your Home Screen and come back to this page.</li>
        </ol>
      </AlertDescription>
    </Alert>
  );
}

function ThisDevice({ devices, onChange }: { devices: Device[]; onChange: () => void }) {
  const { vapidPublicKey } = useMe();
  const [support, setSupport] = useState(pushSupport);
  const { endpoint, refresh } = useThisDeviceEndpoint();
  const [name, setName] = useState(defaultDeviceName);
  const qc = useQueryClient();
  const registered = endpoint ? devices.find((d) => d.endpoint === endpoint) : undefined;
  const active = Boolean(endpoint && registered);

  const enable = useMutation({
    mutationFn: () => enablePush(vapidPublicKey, name.trim() || defaultDeviceName()),
    onSuccess: () => {
      toast.success("Notifications enabled on this device");
      refresh();
      onChange();
    },
    onError: (e) => {
      setSupport(pushSupport());
      toast.error(errorMessage(e));
    },
  });

  const disable = useMutation({
    mutationFn: async () => {
      await disablePushOnThisDevice();
      if (registered) await api.deleteDevice(registered.id);
    },
    onSuccess: () => {
      refresh();
      onChange();
    },
  });

  const test = useMutation({
    mutationFn: () => api.send({ message: "If you can see this, notifications work on this device. 🎉", title: "Test notification", to: "me" }),
    onSuccess: () => {
      toast.success("Test sent. It should arrive in a few seconds.");
      void qc.invalidateQueries({ queryKey: ["feed"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (support.state === "needs-install") return <InstallInstructions />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {active ? <BellRing className="size-5 text-primary" /> : <BellOff className="size-5 text-muted-foreground" />}
          This device
          {active && <Badge variant="secondary">Receiving notifications</Badge>}
        </CardTitle>
        <CardDescription>
          {support.state === "unsupported"
            ? support.reason
            : support.state === "denied"
              ? "Notifications are blocked for this site. Allow them in your browser or system settings, then reload."
              : active
                ? "Push notifications are delivered here even when Flare is closed."
                : "Turn on push notifications to get alerts here even when Flare is closed."}
        </CardDescription>
      </CardHeader>
      {support.state !== "unsupported" && support.state !== "denied" && !active && (
        <CardContent>
          <Field className="max-w-sm">
            <FieldLabel htmlFor="device-name">Device name</FieldLabel>
            <Input id="device-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
        </CardContent>
      )}
      <CardFooter className="flex flex-wrap gap-2">
        {!active ? (
          <Button
            onClick={() => enable.mutate()}
            disabled={enable.isPending || support.state === "unsupported" || support.state === "denied" || endpoint === undefined}
          >
            <BellRing /> {enable.isPending ? "Enabling…" : "Enable notifications"}
          </Button>
        ) : (
          <>
            <Button onClick={() => test.mutate()} disabled={test.isPending}>
              Send test notification
            </Button>
            <Button variant="outline" onClick={() => disable.mutate()} disabled={disable.isPending}>
              Turn off on this device
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}

function RenameDialog({ device, onClose }: { device: Device | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  useEffect(() => setName(device?.name ?? ""), [device]);
  const save = useMutation({
    mutationFn: () => api.updateDevice(device!.id, { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["devices"] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={Boolean(device)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Rename device</DialogTitle>
          </DialogHeader>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DevicesPage() {
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ["devices"], queryFn: api.devices });
  const [renaming, setRenaming] = useState<Device | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["devices"] });
  const toggle = useMutation({
    mutationFn: (d: Device) => api.updateDevice(d.id, { enabled: !d.enabled }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (d: Device) => api.deleteDevice(d.id), onSuccess: refresh });

  return (
    <>
      <PageHeader title="Devices" description="Every browser or installed app that receives your notifications." />
      <div className="space-y-6">
        <ThisDevice devices={devices.data ?? []} onChange={refresh} />

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">All devices</h2>
          {devices.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No devices yet. Enable notifications above on each phone or browser you use.</p>
          )}
          <ul className="divide-y rounded-xl border">
            {devices.data?.map((d) => (
              <li key={d.id} className="flex items-center gap-3 p-4">
                {/iPhone|iPad|Android/.test(d.name) ? (
                  <Smartphone className="size-5 shrink-0 text-muted-foreground" />
                ) : (
                  <Laptop className="size-5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Added {timeAgo(d.createdAt)}
                    {d.lastPushAt && ` · last notification ${timeAgo(d.lastPushAt)}`}
                  </p>
                  {d.lastError && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                      <TriangleAlert className="size-3" /> {d.lastError}
                    </p>
                  )}
                </div>
                <Switch
                  checked={d.enabled}
                  onCheckedChange={() => toggle.mutate(d)}
                  aria-label={d.enabled ? "Pause notifications" : "Resume notifications"}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Device actions">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setRenaming(d)}>
                      <Pencil /> Rename
                    </DropdownMenuItem>
                    <Confirm
                      title={`Remove ${d.name}?`}
                      description="It will stop receiving notifications. You can add it again from that device."
                      confirmLabel="Remove"
                      onConfirm={() => remove.mutateAsync(d)}
                    >
                      <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                        <Trash2 /> Remove
                      </DropdownMenuItem>
                    </Confirm>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        </section>

        <Alert>
          <TriangleAlert />
          <AlertTitle>About alert sounds</AlertTitle>
          <AlertDescription>
            Web push notifications use your device's standard notification sound. Flare plays the chosen alert sound
            while the app is open. Custom sounds for background notifications will need the native app.
          </AlertDescription>
        </Alert>
      </div>
      <RenameDialog device={renaming} onClose={() => setRenaming(null)} />
    </>
  );
}
