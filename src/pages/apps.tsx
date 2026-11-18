import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { type App, PRIORITIES, type Priority } from "@shared/types";
import { Confirm } from "@/components/confirm";
import { CodeBlock, CopyButton } from "@/components/copy-button";
import { PageHeader } from "@/components/page";
import { SoundSelect } from "@/components/sound-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/format";

interface AppFormValue {
  name: string;
  description: string;
  defaultSound: string | null;
  defaultPriority: Priority;
}

function AppDialog({
  open,
  app,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  app?: App;
  onOpenChange: (o: boolean) => void;
  onCreated?: (secret: string, app: App) => void;
}) {
  const qc = useQueryClient();
  const [v, setV] = useState<AppFormValue>({ name: "", description: "", defaultSound: null, defaultPriority: 0 });
  useEffect(() => {
    if (open)
      setV({
        name: app?.name ?? "",
        description: app?.description ?? "",
        defaultSound: app?.defaultSound ?? null,
        defaultPriority: app?.defaultPriority ?? 0,
      });
  }, [open, app]);

  const save = useMutation({
    mutationFn: async () => {
      const body = { ...v, description: v.description || null };
      if (app) return { app: await api.updateApp(app.id, body), secret: null };
      return api.createApp(body);
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["apps"] });
      onOpenChange(false);
      if (res.secret) onCreated?.(res.secret, res.app);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-5"
        >
          <DialogHeader>
            <DialogTitle>{app ? "Edit app" : "New app"}</DialogTitle>
            <DialogDescription>
              An app is a service that sends you notifications, like a backup script or Home Assistant. Each gets its own API keys.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="app-name">Name</FieldLabel>
              <Input
                id="app-name"
                required
                maxLength={80}
                value={v.name}
                onChange={(e) => setV({ ...v, name: e.target.value })}
                placeholder="Home server"
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="app-desc">Description</FieldLabel>
              <Textarea
                id="app-desc"
                maxLength={300}
                rows={2}
                value={v.description}
                onChange={(e) => setV({ ...v, description: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="app-priority">Default priority</FieldLabel>
                <Select
                  value={String(v.defaultPriority)}
                  onValueChange={(p) => setV({ ...v, defaultPriority: Number(p) as Priority })}
                >
                  <SelectTrigger id="app-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={String(p.value)}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="app-sound">Default sound</FieldLabel>
                <SoundSelect id="app-sound" value={v.defaultSound} onChange={(s) => setV({ ...v, defaultSound: s })} />
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {app ? "Save" : "Create app"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SecretDialog({ secret, onClose }: { secret: { value: string; appName: string } | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(secret)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>API key for {secret?.appName}</DialogTitle>
          <DialogDescription>Copy it now. For your security it won't be shown again.</DialogDescription>
        </DialogHeader>
        {secret && (
          <div className="min-w-0 space-y-4">
            <div className="flex gap-2">
              <Input
                readOnly
                value={secret.value}
                aria-label="API key"
                className="min-w-0 flex-1 font-mono text-xs"
                onFocus={(e) => e.target.select()}
              />
              <CopyButton value={secret.value} />
            </div>
            <CodeBlock
              code={`curl ${window.location.origin}/api/v1/messages \\
  -H "Authorization: Bearer ${secret.value}" \\
  -d message="Hello from ${secret.appName}"`}
            />
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AppCard({ app, onEdit, onSecret }: { app: App; onEdit: () => void; onSecret: (s: string) => void }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["apps"] });
  const createKey = useMutation({
    mutationFn: () => api.createKey(app.id, null),
    onSuccess: (res) => {
      void refresh();
      onSecret(res.secret);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({ mutationFn: (keyId: string) => api.revokeKey(app.id, keyId), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api.deleteApp(app.id), onSuccess: refresh });
  const priority = PRIORITIES.find((p) => p.value === app.defaultPriority)?.label;
  const activeKeys = app.keys.filter((k) => !k.revokedAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{app.name}</CardTitle>
        <CardDescription>
          {app.description || "No description"} · {app.messageCount} {app.messageCount === 1 ? "message" : "messages"}
          {app.defaultPriority !== 0 && ` · ${priority} priority`}
          {app.defaultSound && ` · ${app.defaultSound} sound`}
        </CardDescription>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="App actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <Confirm
                title={`Delete ${app.name}?`}
                description="All of its API keys stop working immediately. Messages already sent stay in feeds."
                onConfirm={() => remove.mutateAsync()}
              >
                <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                  <Trash2 /> Delete app
                </DropdownMenuItem>
              </Confirm>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y rounded-lg border">
          {app.keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-3 py-2.5">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs">
                  {k.prefix}…{k.label && <span className="ml-2 font-sans text-muted-foreground">{k.label}</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  Created {timeAgo(k.createdAt)} ·{" "}
                  {k.revokedAt
                    ? `revoked ${timeAgo(k.revokedAt)}`
                    : k.lastUsedAt
                      ? `last used ${timeAgo(k.lastUsedAt)}`
                      : "never used"}
                </p>
              </div>
              {k.revokedAt ? (
                <Badge variant="outline">Revoked</Badge>
              ) : (
                <Confirm
                  title="Revoke this key?"
                  description="Anything using it will immediately stop being able to send notifications."
                  confirmLabel="Revoke"
                  onConfirm={() => revoke.mutateAsync(k.id)}
                >
                  <Button variant="ghost" size="sm" className="text-destructive">
                    Revoke
                  </Button>
                </Confirm>
              )}
            </li>
          ))}
        </ul>
        <Button variant="outline" size="sm" onClick={() => createKey.mutate()} disabled={createKey.isPending || activeKeys.length >= 10}>
          <Plus /> New key
        </Button>
      </CardContent>
    </Card>
  );
}

export function AppsPage() {
  const apps = useQuery({ queryKey: ["apps"], queryFn: api.apps });
  const [dialog, setDialog] = useState<{ open: boolean; app?: App }>({ open: false });
  const [secret, setSecret] = useState<{ value: string; appName: string } | null>(null);

  return (
    <>
      <PageHeader
        title="Apps & API keys"
        description={
          <>
            Services use an app's API key to send notifications. See the <Link className="underline" to="/docs">API docs</Link>.
          </>
        }
        actions={
          <Button onClick={() => setDialog({ open: true })}>
            <Plus /> New app
          </Button>
        }
      />

      {apps.data?.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRound />
            </EmptyMedia>
            <EmptyTitle>No apps yet</EmptyTitle>
            <EmptyDescription>Create an app to get an API key your scripts and services can send notifications with.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setDialog({ open: true })}>
              <Plus /> Create your first app
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-4">
          <Alert>
            <KeyRound />
            <AlertTitle>Keep keys secret</AlertTitle>
            <AlertDescription>
              Anyone with a key can send notifications as you, to you and to your groups. Revoke a key if it leaks.
            </AlertDescription>
          </Alert>
          {apps.data?.map((app) => (
            <AppCard
              key={app.id}
              app={app}
              onEdit={() => setDialog({ open: true, app })}
              onSecret={(value) => setSecret({ value, appName: app.name })}
            />
          ))}
        </div>
      )}

      <AppDialog
        open={dialog.open}
        app={dialog.app}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onCreated={(value, app) => setSecret({ value, appName: app.name })}
      />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </>
  );
}
