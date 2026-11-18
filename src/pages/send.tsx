import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Send, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PRIORITIES, type Priority, type SendMessageRequest } from "@shared/types";
import { CodeBlock } from "@/components/copy-button";
import { PageHeader } from "@/components/page";
import { PriorityIcon } from "@/components/priority";
import { SoundSelect } from "@/components/sound-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";

const NO_APP = "__none__";

function RecipientInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api.groups() });
  const add = (spec: string) => {
    const s = spec.trim().replace(/,$/, "");
    if (s && !value.includes(s)) onChange([...value, s]);
    setDraft("");
  };
  const suggestions = ["me", ...(groups.data?.map((g) => `group:${g.slug}`) ?? [])].filter((s) => !value.includes(s));

  return (
    <div className="space-y-2">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border bg-transparent px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
        {value.map((v) => (
          <Badge key={v} variant="secondary" className="gap-1 pr-1">
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              className="rounded-sm opacity-60 hover:opacity-100"
              onClick={() => onChange(value.filter((x) => x !== v))}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          id="to"
          value={draft}
          onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft && add(draft)}
          placeholder={value.length ? "" : "me, group:family, someone@example.com"}
          className="min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => add(s)}>
              <Badge variant="outline" className="gap-1 hover:bg-muted">
                <Plus className="size-3" />
                {s}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function curlFor(body: SendMessageRequest) {
  const { app_id: _, ...rest } = body;
  const json = JSON.stringify(rest, null, 2).replace(/'/g, "'\\''");
  return `curl ${window.location.origin}/api/v1/messages \\
  -H "Authorization: Bearer $FLARE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${json}'`;
}

export function SendPage() {
  const qc = useQueryClient();
  const apps = useQuery({ queryKey: ["apps"], queryFn: api.apps });
  const [to, setTo] = useState<string[]>(["me"]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<Priority>(0);
  const [sound, setSound] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [html, setHtml] = useState(false);
  const [appId, setAppId] = useState<string>(NO_APP);
  const [retry, setRetry] = useState("60");
  const [expire, setExpire] = useState("3600");

  const body: SendMessageRequest = {
    message: message || "Hello from Flare",
    ...(title && { title }),
    to: to.length === 1 ? to[0] : to,
    ...(priority !== 0 && { priority }),
    ...(sound && { sound }),
    ...(url && { url }),
    ...(url && urlTitle && { url_title: urlTitle }),
    ...(html && { html: true }),
    ...(priority === 2 && { retry: Number(retry), expire: Number(expire) }),
    ...(appId !== NO_APP && { app_id: appId }),
  };

  const send = useMutation({
    mutationFn: () => api.send({ ...body, message }),
    onSuccess: (res) => {
      toast.success(`Sent to ${res.recipients} ${res.recipients === 1 ? "person" : "people"}`, {
        description: res.receipt ? `Receipt ${res.receipt}` : undefined,
      });
      setMessage("");
      setTitle("");
      void qc.invalidateQueries({ queryKey: ["feed"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <PageHeader title="Send" description="Compose a notification by hand. Your services can do the same with an API key." />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="to">To</FieldLabel>
              <RecipientInput value={to} onChange={setTo} />
              <FieldDescription>
                <code>me</code>, <code>group:&lt;slug&gt;</code>, or the email of someone you share a group with.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="title">Title</FieldLabel>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={250} placeholder="Optional" />
            </Field>
            <Field>
              <FieldLabel htmlFor="message">Message</FieldLabel>
              <Textarea
                id="message"
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={4096}
                rows={4}
                placeholder="The backup finished in 4m 12s."
              />
              <div className="flex items-center gap-2">
                <Switch id="html" checked={html} onCheckedChange={setHtml} />
                <FieldLabel htmlFor="html" className="font-normal">
                  Allow basic HTML (<code>&lt;b&gt; &lt;i&gt; &lt;u&gt; &lt;a&gt; &lt;font color&gt;</code>)
                </FieldLabel>
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="priority">Priority</FieldLabel>
                <Select value={String(priority)} onValueChange={(v) => setPriority(Number(v) as Priority)}>
                  <SelectTrigger id="priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={String(p.value)}>
                        <PriorityIcon priority={p.value} />
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>{PRIORITIES.find((p) => p.value === priority)?.description}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="sound">Sound</FieldLabel>
                <SoundSelect id="sound" value={sound} onChange={setSound} />
              </Field>
            </div>
            {priority === 2 && (
              <div className="grid gap-4 rounded-lg border border-red-500/30 bg-red-500/5 p-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="retry">Repeat every (seconds)</FieldLabel>
                  <Input id="retry" type="number" min={30} value={retry} onChange={(e) => setRetry(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="expire">Stop after (seconds)</FieldLabel>
                  <Input id="expire" type="number" min={30} max={10800} value={expire} onChange={(e) => setExpire(e.target.value)} />
                </Field>
                <FieldDescription className="sm:col-span-2">
                  Re-sent to every recipient until one of them acknowledges it, or it expires (max 3 hours).
                </FieldDescription>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="url">Link</FieldLabel>
                <Input id="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
              </Field>
              <Field>
                <FieldLabel htmlFor="url_title">Link title</FieldLabel>
                <Input id="url_title" value={urlTitle} onChange={(e) => setUrlTitle(e.target.value)} disabled={!url} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="app">Send as</FieldLabel>
              <Select value={appId} onValueChange={setAppId}>
                <SelectTrigger id="app">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_APP}>Yourself (no app)</SelectItem>
                  {apps.data?.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div>
              <Button type="submit" disabled={send.isPending || !message.trim()}>
                <Send /> {send.isPending ? "Sending…" : "Send notification"}
              </Button>
            </div>
          </FieldGroup>
        </form>

        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle className="text-sm">Same thing with curl</CardTitle>
          </CardHeader>
          <CardContent>
            <CodeBlock code={curlFor(body)} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
