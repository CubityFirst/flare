import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Music, Play, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { Sound } from "@shared/types";
import { Confirm } from "@/components/confirm";
import { PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { bytes } from "@/lib/format";
import { playSound } from "@/lib/sounds";

function SoundRow({ sound, onDelete }: { sound: Sound; onDelete?: () => Promise<unknown> }) {
  return (
    <li className="flex items-center gap-3 p-3">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={`Play ${sound.name}`}
        disabled={sound.slug === "none"}
        onClick={() => playSound(sound.slug, sound.url)}
      >
        <Play />
      </Button>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{sound.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          <span className="font-mono">{sound.slug}</span>
          {sound.description && ` · ${sound.description}`}
          {sound.size !== undefined && ` · ${bytes(sound.size)}`}
        </p>
      </div>
      {sound.slug === "flare" && <Badge variant="secondary">Default</Badge>}
      {onDelete && (
        <Confirm
          title={`Delete ${sound.name}?`}
          description="Apps using it as their default fall back to the standard sound."
          onConfirm={onDelete}
        >
          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${sound.name}`}>
            <Trash2 />
          </Button>
        </Confirm>
      )}
    </li>
  );
}

export function SoundsPage() {
  const qc = useQueryClient();
  const sounds = useQuery({ queryKey: ["sounds"], queryFn: api.sounds });
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");

  const upload = useMutation({
    mutationFn: () => api.uploadSound(file!, name),
    onSuccess: (s) => {
      toast.success(`Uploaded "${s.name}". Use it with sound: "${s.slug}"`);
      setFile(null);
      setName("");
      if (fileRef.current) fileRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["sounds"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSound(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sounds"] }),
  });

  const builtin = sounds.data?.filter((s) => s.builtin) ?? [];
  const custom = sounds.data?.filter((s) => !s.builtin) ?? [];

  return (
    <>
      <PageHeader title="Sounds" description="Pick a sound per message, or set a default for each app." />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="size-4" /> Upload a sound
            </CardTitle>
            <CardDescription>MP3, WAV, OGG, AAC or M4A, up to 1 MB. Short clips (under 5 seconds) work best.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                upload.mutate();
              }}
            >
              <Field>
                <FieldLabel htmlFor="sound-file">File</FieldLabel>
                <Input
                  id="sound-file"
                  ref={fileRef}
                  type="file"
                  accept="audio/*"
                  required
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setFile(f);
                    if (f && !name) setName(f.name.replace(/\.[^.]+$/, ""));
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="sound-name">Name</FieldLabel>
                <Input id="sound-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Button type="submit" disabled={!file || upload.isPending}>
                {upload.isPending ? "Uploading…" : "Upload"}
              </Button>
            </form>
            <FieldDescription className="mt-3">
              Sounds play when Flare is open. Background notifications use the device's own notification sound.
            </FieldDescription>
          </CardContent>
        </Card>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Your sounds</h2>
          {custom.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Music className="size-4" /> You haven't uploaded any sounds yet.
            </p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {custom.map((s) => (
                <SoundRow key={s.slug} sound={s} onDelete={() => remove.mutateAsync(s.id!)} />
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Built-in</h2>
          <ul className="divide-y rounded-xl border">
            {builtin.map((s) => (
              <SoundRow key={s.slug} sound={s} />
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
